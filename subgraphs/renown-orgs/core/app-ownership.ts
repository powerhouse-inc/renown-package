import type { PHDocument } from "document-model";
import { GraphQLError } from "graphql";
import { getAddress } from "viem";
import { actions as profileActions } from "../../../document-models/renown-app-profile/index.js";
import { actions as orgActions } from "../../../document-models/renown-organization/index.js";
import { pkhDidFor } from "../../renown-stats/core/dids.js";
import type { OrgRuntime } from "../runtime.js";
import {
  appPublisher,
  setAppPublisher,
  setWorkloadOwner,
  workloadOwner,
  type PublisherFields,
  type WorkloadOwnerFields,
} from "../store/foreign.js";
import type { OrgAppRecord, PartyKind } from "../store/types.js";
import { badInput, orgError, unavailable } from "./errors.js";

/** Transfers expire 14 days after they were made. */
export const TRANSFER_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** Who owns an app: an organisation, or a person (lowercase address). */
export type AppOwner = { kind: "ORG"; orgId: string } | { kind: "PERSON"; address: string };

export function ownerOf(kind: PartyKind, id: string): AppOwner {
  return kind === "ORG" ? { kind: "ORG", orgId: id } : { kind: "PERSON", address: id };
}

export function partyId(owner: AppOwner): string {
  return owner.kind === "ORG" ? owner.orgId : owner.address;
}

export function sameOwner(a: AppOwner | undefined, b: AppOwner): boolean {
  return a !== undefined && a.kind === b.kind && partyId(a) === partyId(b);
}

function publisherOwner(publisher: PublisherFields): AppOwner {
  return publisher.publisherOrgId ? { kind: "ORG", orgId: publisher.publisherOrgId } : { kind: "PERSON", address: publisher.publisherAddress.toLowerCase() };
}

/** Who owns the app according to its profile index (renown-stats); undefined without a profile. */
export async function currentOwner(rt: OrgRuntime, appDid: string): Promise<AppOwner | undefined> {
  const publisher = await appPublisher(rt.deps.relationalDb, appDid);
  return publisher && publisherOwner(publisher);
}

function ownsWorkload(workload: WorkloadOwnerFields, owner: AppOwner): boolean {
  return owner.kind === "ORG"
    ? workload.ownerOrgId === owner.orgId
    : workload.ownerOrgId === null && workload.ownerAddress.toLowerCase() === owner.address;
}

/** A guarded write found the app no longer owned as the transfer expects. */
class OwnershipChanged extends Error {}

function isAppFrozen(error: unknown): boolean {
  return error instanceof GraphQLError && error.extensions.code === "APP_FROZEN";
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function documentState<T>(rt: OrgRuntime, id: string): Promise<T> {
  const doc: PHDocument = await rt.deps.reactorClient.get(id);
  return (doc.state as unknown as { global: T }).global;
}

async function documentListsApp(rt: OrgRuntime, orgId: string, appDid: string): Promise<boolean> {
  const state = await documentState<{ apps?: { appDid: string }[] }>(rt, orgId);
  return (state.apps ?? []).some((app) => app.appDid === appDid);
}

/**
 * Moves an app from `from` to `to` everywhere it is recorded, stats,
 * metrics and history staying keyed by the app DID. Every write is guarded
 * (compare-and-set on the expected owner), in this order:
 *
 * 1. the renown-stats profile index (publisher_org_id, publisher_address):
 *    leaving an organisation clears publisher_org_id first, which ends
 *    renown-stats' repair path (it re-attaches only apps whose profile names
 *    the organisation);
 * 2. org_apps, in one transaction (remove from the source organisation,
 *    refused for a frozen app; add to the target);
 * 3. the renown-workload identity owner (owner_org_id, owner_address);
 * 4. the app profile document's publisherDid;
 * 5. the organisation documents (mirrors of org_apps).
 *
 * A failure at any step undoes the earlier ones in reverse, so the app stays
 * with its original owner: BAD_USER_INPUT (field transferId) when the source
 * no longer owns it, APP_FROZEN, else SERVICE_UNAVAILABLE.
 */
export async function moveApp(rt: OrgRuntime, appDid: string, from: AppOwner, to: AppOwner, now: Date): Promise<void> {
  const db = rt.deps.relationalDb;
  const store = rt.store();
  const undo: { what: string; run: () => Promise<unknown> }[] = [];
  try {
    // Read-only checks first, so a stale transfer changes nothing.
    const publisher = await appPublisher(db, appDid);
    if (!publisher || !sameOwner(publisherOwner(publisher), from)) throw new OwnershipChanged("The source no longer owns the app");
    const workload = await workloadOwner(db, appDid);
    if (workload && !ownsWorkload(workload, from)) throw new OwnershipChanged("The app's workload identity is not the source's");

    // 1. The profile index.
    const before: PublisherFields = { publisherAddress: publisher.publisherAddress, publisherOrgId: publisher.publisherOrgId };
    const after: PublisherFields =
      to.kind === "ORG" ? { publisherAddress: before.publisherAddress, publisherOrgId: to.orgId } : { publisherAddress: to.address, publisherOrgId: null };
    if (!(await setAppPublisher(db, appDid, after, before))) throw new OwnershipChanged("The source no longer owns the app");
    undo.push({ what: "the app profile index", run: () => setAppPublisher(db, appDid, before, after) });

    // 2. org_apps.
    const removed = await store.transaction(async (tx): Promise<OrgAppRecord | undefined> => {
      let gone: OrgAppRecord | undefined;
      if (from.kind === "ORG") {
        gone = await tx.deleteOrgApp(appDid, from.orgId);
        if (!gone) throw new OwnershipChanged("The app no longer belongs to the organisation");
        if (gone.frozen) throw orgError("APP_FROZEN", "The app is frozen by its organisation");
      } else if (await tx.orgOfApp(appDid)) {
        throw new OwnershipChanged("The app belongs to an organisation");
      }
      if (to.kind === "ORG" && !(await tx.insertOrgApp({ appDid, orgId: to.orgId, frozen: false, addedAt: now }))) {
        throw new OwnershipChanged("The app belongs to an organisation");
      }
      return gone;
    });
    undo.push({
      what: "org_apps",
      run: () =>
        store.transaction(async (tx) => {
          if (to.kind === "ORG") await tx.deleteOrgApp(appDid, to.orgId);
          if (removed) await tx.insertOrgApp(removed);
        }),
    });

    // 3. The workload identity.
    if (workload) {
      const next: WorkloadOwnerFields =
        to.kind === "ORG" ? { ownerAddress: workload.ownerAddress, ownerOrgId: to.orgId } : { ownerAddress: getAddress(to.address), ownerOrgId: null };
      if (!(await setWorkloadOwner(db, appDid, next, workload, now))) throw new OwnershipChanged("The app's workload identity is not the source's");
      undo.push({ what: "the workload identity", run: () => setWorkloadOwner(db, appDid, workload, next, now) });
    }

    // 4. The profile document.
    const previousDid =
      (await documentState<{ publisherDid?: string | null }>(rt, publisher.documentId)).publisherDid ||
      (from.kind === "ORG" ? rt.policy().orgDid(from.orgId) : pkhDidFor(from.address));
    const nextDid = to.kind === "ORG" ? rt.policy().orgDid(to.orgId) : pkhDidFor(to.address);
    await rt.execute(publisher.documentId, [profileActions.setPublisherDid({ publisherDid: nextDid })]);
    undo.push({
      what: "the app profile document",
      run: () => rt.execute(publisher.documentId, [profileActions.setPublisherDid({ publisherDid: previousDid })]),
    });

    // 5. The organisation documents (an app already mirrored as wanted is left alone).
    if (removed && (await documentListsApp(rt, removed.orgId, appDid))) {
      await rt.execute(removed.orgId, [orgActions.removeOrgApp({ appDid })]);
      undo.push({
        what: `organisation document ${removed.orgId}`,
        run: () => rt.execute(removed.orgId, [orgActions.addOrgApp({ appDid, addedAt: removed.addedAt.toISOString() })]),
      });
    }
    if (to.kind === "ORG" && !(await documentListsApp(rt, to.orgId, appDid))) {
      await rt.execute(to.orgId, [orgActions.addOrgApp({ appDid, addedAt: now.toISOString() })]);
    }
  } catch (error) {
    for (const step of undo.reverse()) {
      try {
        if ((await step.run()) === false) console.error(`[renown-orgs] moveApp ${appDid}: ${step.what} changed meanwhile; not restored`);
      } catch (undoError) {
        console.error(`[renown-orgs] moveApp ${appDid}: could not restore ${step.what}: ${describe(undoError)}`);
      }
    }
    if (error instanceof OwnershipChanged) throw badInput("transferId", error.message);
    if (isAppFrozen(error)) throw error;
    console.error(`[renown-orgs] moveApp ${appDid} failed and was undone: ${describe(error)}`);
    throw unavailable();
  }
}
