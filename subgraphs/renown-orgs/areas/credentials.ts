import { actions as orgActions, type RenownOrganizationDocument } from "../../../document-models/renown-organization/index.js";
import type { OrgArgs, OrgContext } from "../core/auth.js";
import { requireOrg, requireRole } from "../core/authz.js";
import { mapLimited } from "../core/concurrency.js";
import { badInput, notFound, unavailable } from "../core/errors.js";
import type { CredentialVerdict } from "../core/org-policy.js";
import { iso, isoOrNull, memberStatus } from "../output.js";
import type { Area, MembershipEnded, OrgRuntime } from "../runtime.js";
import { credentialById, credentialsForApps, liveCredentialsOf, type CredentialRow } from "../store/foreign.js";
import type { MemberRecord } from "../store/types.js";
import { addressArg, writeDocument } from "./members.js";

const MAX_LISTED = 500;
/** credentialIds per suspendOrgCredentials call. */
export const MAX_SUSPEND_IDS = 100;
/** Concurrent status checks while listing. */
const STATUS_CONCURRENCY = 10;

/** A read of the credential read model or of organisation rules; a failure is SERVICE_UNAVAILABLE (never a verdict). */
async function guarded<T>(what: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    console.error(`[renown-orgs] ${what} unavailable: ${error instanceof Error ? error.message : "unknown error"}`);
    throw unavailable("Credentials cannot be checked right now");
  }
}

async function statusOf(rt: OrgRuntime, row: CredentialRow) {
  const verdict: CredentialVerdict = await guarded("credential status", () =>
    rt.policy().credentialStatus({ credentialId: row.credentialId, appDid: row.appDid, issuer: row.issuer, issuedAt: row.issuanceDate }),
  );
  return { credentialId: row.credentialId, appDid: row.appDid || null, orgId: verdict.orgId, counts: verdict.counts, reason: verdict.reason };
}

async function appsOf(rt: OrgRuntime, orgId: string): Promise<string[]> {
  return (await rt.store().orgApps(orgId)).map((app) => app.appDid);
}

/**
 * Suspends `credentialIds` for `orgId` (call under the org lock): the store
 * first, then the document, then the activity. Returns the newly suspended
 * ids. Admin writes compensate a failed document write (the new suspensions
 * are lifted again: SERVICE_UNAVAILABLE); exits keep them and log the
 * missing mirror, since the store is what counting reads and a suspension
 * must survive a re-join.
 */
async function suspend(
  rt: OrgRuntime,
  field: string,
  orgId: string,
  credentialIds: readonly string[],
  reason: "ADMIN" | "MEMBER_LEFT" | "MEMBER_REMOVED",
  memberAddress: string | null,
  actor: string,
  now: Date,
): Promise<string[]> {
  const store = rt.store();
  const added = await store.suspendCredentials(credentialIds.map((credentialId) => ({ orgId, credentialId, reason, memberAddress, at: now })));
  if (added.length === 0) return added;
  const mirror = [orgActions.suspendCredentials({ credentialIds: added })];
  if (reason === "ADMIN") {
    await writeDocument(rt, field, orgId, mirror, async () => {
      for (const id of added) await store.unsuspendCredential(orgId, id);
    });
  } else {
    try {
      await rt.execute(orgId, mirror);
    } catch (error) {
      console.error(`[renown-orgs] ${field}: document ${orgId} did not record suspensions (${error instanceof Error ? error.message : "unknown error"}); kept in the store`);
    }
  }
  const data = { credentialIds: added, reason };
  await rt.record({
    orgId,
    actor,
    action: reason === "ADMIN" ? field : "system.suspendOnExit",
    at: now,
    details: { ...data, memberAddress },
    event: { type: "credential.suspended", data },
  });
  return added;
}

/**
 * Leaving or removal suspends the member's live delegations for the
 * organisation's apps (they stay suspended if the member re-joins). When
 * they cannot be listed, a member-level suspension (org_member_suspensions,
 * never a credential id) suspends every delegation the address issued up to
 * now, failing closed. Runs inside endMembership, which already holds the
 * org lock.
 */
function suspendOnExit(rt: OrgRuntime) {
  return async (event: MembershipEnded) => {
    const reason = event.reason === "LEFT" ? "MEMBER_LEFT" : "MEMBER_REMOVED";
    let ids: string[];
    try {
      const apps = await appsOf(rt, event.orgId);
      ids = (await liveCredentialsOf(rt.deps.relationalDb, event.address, apps, event.at)).map((row) => row.credentialId);
    } catch (error) {
      console.error(
        `[renown-orgs] suspendOnExit: delegations of a member of ${event.orgId} unreadable (${error instanceof Error ? error.message : "unknown error"}); suspending the member`,
      );
      await rt.store().suspendMember({ orgId: event.orgId, address: event.address, reason, at: event.at });
      const data = { credentialIds: [], memberAddress: event.address, reason, memberLevel: true };
      await rt.record({
        orgId: event.orgId,
        actor: "system",
        action: "memberCredentialsSuspended",
        at: event.at,
        details: { ...data, suspendedAt: event.at.toISOString(), endedBy: event.actor },
        event: { type: "credential.suspended", data },
      });
      return;
    }
    await suspend(rt, "suspendOnExit", event.orgId, ids, reason, event.address, event.actor, event.at);
  };
}

/**
 * Lifts the member-level suspension that covers `row` (its issuer's, issued
 * at or before it), if any, call under the org lock: the issuer's other live
 * delegations it covered become per-credential suspensions first (action
 * convertMemberSuspension), so only `row` starts counting. True when one was lifted.
 */
async function liftMemberSuspension(rt: OrgRuntime, orgId: string, row: CredentialRow, actor: string, now: Date): Promise<boolean> {
  const store = rt.store();
  const suspension = await store.memberSuspension(orgId, row.issuer);
  if (!suspension || suspension.at.getTime() < row.issuanceDate.getTime()) return false;
  const apps = await appsOf(rt, orgId);
  const covered = await guarded("credential read model", () => liveCredentialsOf(rt.deps.relationalDb, row.issuer, apps, now, suspension.at));
  const others = covered.map((c) => c.credentialId).filter((id) => id !== row.credentialId);
  await suspend(rt, "convertMemberSuspension", orgId, others, "ADMIN", row.issuer, actor, now);
  await store.liftMemberSuspension(orgId, row.issuer);
  await rt.record({
    orgId,
    actor,
    action: "liftMemberSuspension",
    at: now,
    details: { memberAddress: row.issuer, reason: suspension.reason, suspendedAt: suspension.at.toISOString(), credentialId: row.credentialId },
  });
  return true;
}

/** The issuer's ACTIVE membership record, else their latest one. */
function issuerMember(members: readonly MemberRecord[], address: string): MemberRecord | undefined {
  const own = members.filter((m) => m.address === address);
  return own.find((m) => m.status === "ACTIVE") ?? own.at(-1);
}

/** Whether the organisation document still lists the suspension (a read failure assumes it does). */
async function documentLists(rt: OrgRuntime, orgId: string, credentialId: string): Promise<boolean> {
  try {
    const doc = await rt.deps.reactorClient.get<RenownOrganizationDocument>(orgId);
    return doc.state.global.suspendedCredentialIds.includes(credentialId);
  } catch {
    return true;
  }
}

/** Delegations under organisation rules (spec 3.7): status, listing, suspensions. */
export const credentialResolvers: Area = (rt) => {
  rt.hooks.membershipEnded.push(suspendOnExit(rt));
  return {
    Query: {
      orgCredentialStatus: async (_: unknown, args: { credentialId: string }, ctx: OrgContext) => {
        rt.throttleRead(ctx);
        const row = await guarded("credential read model", () => credentialById(rt.deps.relationalDb, args.credentialId));
        return row ? statusOf(rt, row) : null;
      },
      orgCredentials: async (_: unknown, args: OrgArgs & { orgId: string }, ctx: OrgContext) => {
        const caller = await rt.caller(ctx, "orgCredentials", args);
        const store = rt.store();
        await requireOrg(store, args.orgId, { writable: false });
        await requireRole(store, args.orgId, caller, "ADMIN");
        const apps = await appsOf(rt, args.orgId);
        const rows = await guarded("credential read model", () => credentialsForApps(rt.deps.relationalDb, apps, MAX_LISTED));
        const members = await store.members(args.orgId);
        const now = rt.now();
        return mapLimited(rows, STATUS_CONCURRENCY, async (row) => {
            const member = issuerMember(members, row.issuer);
            return {
              credentialId: row.credentialId,
              documentId: row.documentId,
              appDid: row.appDid,
              issuer: row.issuer,
              issuerRole: member?.role ?? null,
              issuerStatus: member ? memberStatus(member, now) : null,
              issuanceDate: iso(row.issuanceDate),
              expirationDate: isoOrNull(row.expirationDate),
              revoked: row.revoked,
              status: await statusOf(rt, row),
            };
        });
      },
    },
    Mutation: {
      suspendOrgCredentials: async (
        _: unknown,
        args: OrgArgs & { orgId: string; credentialIds?: string[] | null; memberAddress?: string | null },
        ctx: OrgContext,
      ) => {
        const caller = await rt.writer(ctx, "suspendOrgCredentials", args);
        if ((args.credentialIds == null) === (args.memberAddress == null)) {
          throw badInput("credentialIds", "Pass exactly one of credentialIds and memberAddress");
        }
        return rt.lock(`org:${args.orgId}`, async () => {
          const store = rt.store();
          const now = rt.now();
          await requireOrg(store, args.orgId);
          await requireRole(store, args.orgId, caller, "ADMIN");
          const apps = await appsOf(rt, args.orgId);
          let ids: string[];
          let memberAddress: string | null = null;
          if (args.credentialIds != null) {
            ids = [...new Set(args.credentialIds)];
            if (ids.length > MAX_SUSPEND_IDS) throw badInput("credentialIds", `At most ${MAX_SUSPEND_IDS} credentials at once`);
            for (const id of ids) {
              const row = await guarded("credential read model", () => credentialById(rt.deps.relationalDb, id));
              if (!row || !apps.includes(row.appDid)) throw badInput("credentialIds", `${id} is not a delegation for an app of this organisation`);
            }
          } else {
            const address = addressArg("memberAddress", args.memberAddress ?? "");
            memberAddress = address;
            ids = (await guarded("credential read model", () => liveCredentialsOf(rt.deps.relationalDb, address, apps, now))).map((row) => row.credentialId);
          }
          return suspend(rt, "suspendOrgCredentials", args.orgId, ids, "ADMIN", memberAddress, caller, now);
        });
      },
      unsuspendOrgCredential: async (_: unknown, args: OrgArgs & { orgId: string; credentialId: string }, ctx: OrgContext) => {
        const caller = await rt.writer(ctx, "unsuspendOrgCredential", args);
        return rt.lock(`org:${args.orgId}`, async () => {
          const store = rt.store();
          const now = rt.now();
          await requireOrg(store, args.orgId);
          await requireRole(store, args.orgId, caller, "ADMIN");
          // A member-level suspension covering this credential is lifted with it
          // (its other delegations stay suspended individually).
          const row = await guarded("credential read model", () => credentialById(rt.deps.relationalDb, args.credentialId));
          const resolved = row ? await liftMemberSuspension(rt, args.orgId, row, caller, now) : false;
          const suspension = await store.credentialSuspension(args.orgId, args.credentialId);
          if (!suspension) {
            if (resolved) {
              await rt.record({ orgId: args.orgId, actor: caller, action: "unsuspendOrgCredential", at: now, details: { credentialId: args.credentialId } });
              return true;
            }
            throw notFound("Suspension");
          }
          if (!(await store.unsuspendCredential(args.orgId, args.credentialId))) throw notFound("Suspension");
          // A document that never recorded the suspension (an exit whose mirror failed) has nothing to lift.
          if (await documentLists(rt, args.orgId, args.credentialId)) {
            await writeDocument(rt, "unsuspendOrgCredential", args.orgId, [orgActions.unsuspendCredential({ credentialId: args.credentialId })], () =>
              store.suspendCredentials([suspension]),
            );
          }
          await rt.record({ orgId: args.orgId, actor: caller, action: "unsuspendOrgCredential", at: now, details: { credentialId: args.credentialId } });
          return true;
        });
      },
    },
  };
};
