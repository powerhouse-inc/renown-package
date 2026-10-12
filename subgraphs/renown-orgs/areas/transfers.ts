import { isOrgAppDid } from "../../../document-models/renown-organization/index.js";
import type { OrgNotificationIntent } from "../core/activity.js";
import { currentOwner, moveApp, ownerOf, partyId, sameOwner, TRANSFER_TTL_MS, type AppOwner } from "../core/app-ownership.js";
import type { OrgArgs, OrgContext } from "../core/auth.js";
import { requireOrg, requireRole } from "../core/authz.js";
import { badInput, forbidden, notFound, orgError } from "../core/errors.js";
import { iso, isoOrNull } from "../output.js";
import type { Area, OrgRuntime } from "../runtime.js";
import type { PartyKind, TransferRecord } from "../store/types.js";
import { addressArg } from "./members.js";

export function transferOutput(t: TransferRecord) {
  return {
    id: t.id,
    appDid: t.appDid,
    fromKind: t.fromKind,
    fromId: t.fromId,
    toKind: t.toKind,
    toId: t.toId,
    status: t.status,
    createdAt: iso(t.createdAt),
    expiresAt: iso(t.expiresAt),
    decidedAt: isoOrNull(t.decidedAt),
    decidedBy: t.decidedBy,
    proposalId: t.proposalId,
  };
}

/** True when `caller` speaks for that side: the person, or an ACTIVE admin of the organisation. */
async function speaksFor(rt: OrgRuntime, kind: PartyKind, id: string, caller: string): Promise<boolean> {
  if (kind === "PERSON") return id === caller;
  try {
    await requireRole(rt.store(), id, caller, "ADMIN");
    return true;
  } catch {
    return false;
  }
}

/** The organisation a transfer's audit and events belong to: the recipient when it is one, else the source. */
function recordOrg(t: Pick<TransferRecord, "fromKind" | "fromId" | "toKind" | "toId">): string {
  return t.toKind === "ORG" ? t.toId : t.fromId;
}

/** Records a new PENDING transfer and tells the recipient. The caller holds the `app:<did>` lock. */
export async function createTransfer(
  rt: OrgRuntime,
  input: { appDid: string; from: AppOwner; to: AppOwner; actor: string; proposalId: string | null; now: Date },
): Promise<TransferRecord> {
  const store = rt.store();
  const transfer: TransferRecord = {
    id: rt.newId(),
    appDid: input.appDid,
    fromKind: input.from.kind,
    fromId: partyId(input.from),
    toKind: input.to.kind,
    toId: partyId(input.to),
    status: "PENDING",
    createdAt: input.now,
    expiresAt: new Date(input.now.getTime() + TRANSFER_TTL_MS),
    decidedAt: null,
    decidedBy: null,
    proposalId: input.proposalId,
  };
  try {
    await store.insertTransfer(transfer);
  } catch (error) {
    // Another replica made one first (org_app_transfers_one_pending).
    if (await store.pendingTransferOf(transfer.appDid)) throw badInput(input.proposalId ? "payload" : "appDid", "A transfer of this app is pending");
    throw error;
  }
  const payload = { transferId: transfer.id, appDid: transfer.appDid, from: transfer.fromId };
  await rt.record({
    orgId: recordOrg(transfer),
    actor: input.actor,
    action: input.proposalId ? "proposal.TRANSFER_APP_OUT" : "proposeAppTransfer",
    at: input.now,
    details: { ...payload, to: transfer.toId, ...(input.proposalId ? { proposalId: input.proposalId } : {}) },
    notify: [{ to: transfer.toKind === "ORG" ? "ADMINS" : [transfer.toId], kind: "APP_TRANSFER_REQUEST", payload }],
  });
  return transfer;
}

/** Marks a PENDING transfer EXPIRED (sweeper). The caller holds the `app:<did>` lock. */
export async function expireTransfer(rt: OrgRuntime, transfer: TransferRecord, now: Date): Promise<void> {
  const expired = await rt.store().updateTransfer(transfer.id, { status: "EXPIRED", decidedAt: now }, "PENDING");
  if (!expired) return;
  await rt.record({
    orgId: recordOrg(transfer),
    actor: "system",
    action: "system.expireAppTransfer",
    at: now,
    details: { transferId: transfer.id, appDid: transfer.appDid, status: "EXPIRED" },
  });
}

async function liveTransfer(rt: OrgRuntime, id: string): Promise<TransferRecord> {
  const transfer = await rt.store().transfer(id);
  if (!transfer) throw notFound("Transfer");
  return transfer;
}

function notPending() {
  return badInput("transferId", "The transfer is no longer pending");
}

/** Records the accepted transfer on each organisation involved. */
async function recordAccepted(rt: OrgRuntime, transfer: TransferRecord, caller: string, now: Date): Promise<void> {
  const data = { appDid: transfer.appDid, transferId: transfer.id, from: transfer.fromId, to: transfer.toId };
  const toPerson: OrgNotificationIntent[] = transfer.toKind === "PERSON" ? [{ to: [transfer.toId], kind: "APP_TRANSFER_DONE", payload: data }] : [];
  const fromPerson: OrgNotificationIntent[] = transfer.fromKind === "PERSON" ? [{ to: [transfer.fromId], kind: "APP_TRANSFER_DONE", payload: data }] : [];
  if (transfer.toKind === "ORG") {
    await rt.record({
      orgId: transfer.toId,
      actor: caller,
      action: "acceptAppTransfer",
      at: now,
      details: data,
      event: { type: "app.transferred_in", data },
      notify: [{ to: "ADMINS", kind: "APP_TRANSFER_DONE", payload: data }, ...fromPerson],
    });
  }
  if (transfer.fromKind === "ORG") {
    await rt.record({
      orgId: transfer.fromId,
      actor: caller,
      action: "acceptAppTransfer",
      at: now,
      details: data,
      event: { type: "app.transferred_out", data },
      notify: [{ to: "ADMINS", kind: "APP_TRANSFER_DONE", payload: data }, ...toPerson],
    });
  }
}

export const transferResolvers: Area = (rt) => ({
  Query: {
    appTransfers: async (_: unknown, args: OrgArgs & { appDid?: string | null; orgId?: string | null; address?: string | null }, ctx: OrgContext) => {
      const caller = await rt.caller(ctx, "appTransfers", args);
      const store = rt.store();
      const appDid = args.appDid?.trim() || undefined;
      if (args.orgId) {
        await requireOrg(store, args.orgId, { writable: false });
        await requireRole(store, args.orgId, caller, "ADMIN");
        return (await store.transfers({ appDid, party: { kind: "ORG", id: args.orgId } })).map(transferOutput);
      }
      if (args.address) {
        if (addressArg("address", args.address) !== caller) throw forbidden();
        return (await store.transfers({ appDid, party: { kind: "PERSON", id: caller } })).map(transferOutput);
      }
      if (!appDid) throw badInput("appDid", "Pass appDid, orgId or address");
      const visible: TransferRecord[] = [];
      for (const t of await store.transfers({ appDid })) {
        if ((await speaksFor(rt, t.fromKind, t.fromId, caller)) || (await speaksFor(rt, t.toKind, t.toId, caller))) visible.push(t);
      }
      return visible.map(transferOutput);
    },
  },
  Mutation: {
    proposeAppTransfer: async (_: unknown, args: OrgArgs & { appDid: string; toOrgId: string }, ctx: OrgContext) => {
      const caller = await rt.writer(ctx, "proposeAppTransfer", args);
      const appDid = args.appDid.trim();
      if (!isOrgAppDid(appDid)) throw badInput("appDid", "appDid must be a did:key");
      return rt.lock(`app:${appDid}`, async () => {
        const store = rt.store();
        const owner = await currentOwner(rt, appDid);
        if (!owner) throw notFound("App profile");
        if (owner.kind !== "PERSON" || owner.address !== caller || (await store.orgOfApp(appDid))) {
          throw forbidden("Only the app's personal publisher offers it to an organisation");
        }
        const target = await requireOrg(store, args.toOrgId.trim());
        if (await store.pendingTransferOf(appDid)) throw badInput("appDid", "A transfer of this app is pending");
        const to: AppOwner = { kind: "ORG", orgId: target.id };
        return transferOutput(await createTransfer(rt, { appDid, from: owner, to, actor: caller, proposalId: null, now: rt.now() }));
      });
    },
    acceptAppTransfer: async (_: unknown, args: OrgArgs & { transferId: string }, ctx: OrgContext) => {
      const caller = await rt.writer(ctx, "acceptAppTransfer", args);
      const found = await liveTransfer(rt, args.transferId);
      return rt.lock(`app:${found.appDid}`, async () => {
        const store = rt.store();
        const now = rt.now();
        const transfer = await liveTransfer(rt, found.id);
        if (transfer.status !== "PENDING" || transfer.expiresAt.getTime() <= now.getTime()) throw notPending();
        if (!(await speaksFor(rt, transfer.toKind, transfer.toId, caller))) throw forbidden();
        if (transfer.toKind === "ORG") await requireOrg(store, transfer.toId);
        const from = ownerOf(transfer.fromKind, transfer.fromId);
        const to = ownerOf(transfer.toKind, transfer.toId);
        if (!sameOwner(await currentOwner(rt, transfer.appDid), from)) throw badInput("transferId", "The source no longer owns the app");
        if ((await store.orgOfApp(transfer.appDid))?.frozen) throw orgError("APP_FROZEN", "The app is frozen by its organisation");
        // Claim first (conditional on PENDING), so only one acceptance moves the app;
        // a move that fails was undone, and the transfer goes back to PENDING for a retry.
        const accepted = await store.updateTransfer(transfer.id, { status: "ACCEPTED", decidedAt: now, decidedBy: caller }, "PENDING");
        if (!accepted) throw notPending();
        try {
          await moveApp(rt, transfer.appDid, from, to, now);
        } catch (error) {
          try {
            await store.updateTransfer(transfer.id, { status: "PENDING", decidedAt: null, decidedBy: null }, "ACCEPTED");
          } catch (revertError) {
            console.error(
              `[renown-orgs] transfer ${transfer.id}: could not put it back to PENDING: ${revertError instanceof Error ? revertError.message : String(revertError)}`,
            );
          }
          throw error;
        }
        await recordAccepted(rt, accepted, caller, now);
        return transferOutput(accepted);
      });
    },
    declineAppTransfer: async (_: unknown, args: OrgArgs & { transferId: string }, ctx: OrgContext) => {
      const caller = await rt.writer(ctx, "declineAppTransfer", args);
      const found = await liveTransfer(rt, args.transferId);
      return rt.lock(`app:${found.appDid}`, async () => {
        const store = rt.store();
        const now = rt.now();
        const transfer = await liveTransfer(rt, found.id);
        const recipient = await speaksFor(rt, transfer.toKind, transfer.toId, caller);
        if (!recipient && !(await speaksFor(rt, transfer.fromKind, transfer.fromId, caller))) throw forbidden();
        if (transfer.status !== "PENDING") throw notPending();
        const status = recipient ? "DECLINED" : "CANCELLED";
        const updated = await store.updateTransfer(transfer.id, { status, decidedAt: now, decidedBy: caller }, "PENDING");
        if (!updated) throw notPending();
        await rt.record({
          orgId: recordOrg(transfer),
          actor: caller,
          action: "declineAppTransfer",
          at: now,
          details: { transferId: transfer.id, appDid: transfer.appDid, status },
        });
        return transferOutput(updated);
      });
    },
  },
});
