import { GraphQLError } from "graphql";
import { canonicalJson } from "../../../sdk/orgs.js";
import type { OrgNotificationIntent } from "../core/activity.js";
import type { OrgArgs, OrgContext } from "../core/auth.js";
import { requireOrg, requireRole } from "../core/authz.js";
import { badInput, forbidden, limitReached, notFound, orgError } from "../core/errors.js";
import {
  effectiveThreshold,
  executableAtFor,
  MAX_PENDING_PROPOSALS,
  ownersNotice,
  PROPOSAL_TTL_MS,
  thresholdFor,
  thresholdMet,
  type ProposalInput,
} from "../core/proposals.js";
import { iso, isoOrNull } from "../output.js";
import type { Area, OrgRuntime } from "../runtime.js";
import type { OrgRecord, ProposalKind, ProposalPayload, ProposalRecord, ProposalStatus } from "../store/types.js";
import { PROPOSAL_KINDS } from "./proposal-kinds.js";

export interface ProposalOutput {
  id: string;
  orgId: string;
  kind: ProposalKind;
  payload: Record<keyof ProposalPayload, unknown>;
  proposer: string;
  approvals: string[];
  threshold: number;
  status: ProposalStatus;
  createdAt: string;
  executableAt: string | null;
  expiresAt: string;
  executedAt: string | null;
  reason: string | null;
}

export function proposalOutput(p: ProposalRecord): ProposalOutput {
  return {
    id: p.id,
    orgId: p.orgId,
    kind: p.kind,
    payload: {
      address: p.payload.address ?? null,
      demoteToAdmin: p.payload.demoteToAdmin ?? null,
      appDid: p.payload.appDid ?? null,
      toKind: p.payload.toKind ?? null,
      toId: p.payload.toId ?? null,
      handle: p.payload.handle ?? null,
      domain: p.payload.domain ?? null,
    },
    proposer: p.proposer,
    approvals: [...p.approvals],
    threshold: p.threshold,
    status: p.status,
    createdAt: iso(p.createdAt),
    executableAt: isoOrNull(p.executableAt),
    expiresAt: iso(p.expiresAt),
    executedAt: isoOrNull(p.executedAt),
    reason: p.reason,
  };
}

function notExecutable(message: string) {
  return orgError("PROPOSAL_NOT_EXECUTABLE", message);
}

function isUnavailable(error: unknown): boolean {
  return error instanceof GraphQLError && error.extensions.code === "SERVICE_UNAVAILABLE";
}

async function activeOwners(rt: OrgRuntime, orgId: string): Promise<string[]> {
  return (await rt.store().members(orgId, ["ACTIVE"])).filter((m) => m.role === "OWNER").map((m) => m.address);
}

function isLive(proposal: ProposalRecord, now: Date): boolean {
  return proposal.status === "PENDING" && proposal.expiresAt.getTime() > now.getTime();
}

/** Stores a new PENDING proposal and records its creation. The caller holds the org lock. */
export async function createProposal(
  rt: OrgRuntime,
  org: OrgRecord,
  kind: ProposalKind,
  payload: ProposalPayload,
  proposer: string,
  approvals: string[],
  now: Date,
): Promise<ProposalRecord> {
  const owners = await activeOwners(rt, org.id);
  const draft: ProposalRecord = {
    id: rt.newId(),
    orgId: org.id,
    kind,
    payload,
    proposer,
    approvals,
    status: "PENDING",
    threshold: thresholdFor(kind, owners.length),
    createdAt: now,
    executableAt: null,
    expiresAt: new Date(now.getTime() + PROPOSAL_TTL_MS),
    executedAt: null,
    reason: null,
  };
  const proposal = { ...draft, executableAt: executableAtFor(draft, owners, rt.config(), now) };
  await rt.store().insertProposal(proposal);
  const waiting = owners.filter((owner) => !approvals.includes(owner));
  const note = { proposalId: proposal.id, kind };
  const notify: OrgNotificationIntent[] = ownersNotice("proposal.created", note);
  if (proposal.executableAt === null && waiting.length > 0) notify.push({ to: waiting, kind: "PROPOSAL_NEEDS_APPROVAL", payload: note });
  if (kind === "RECOVER") notify.push({ to: "OWNERS", kind: "RECOVERY_STARTED", payload: { ...note, ...payload } });
  await rt.record({
    orgId: org.id,
    actor: proposer,
    action: kind === "RECOVER" ? "startOrgRecovery" : "proposeOrgChange",
    at: now,
    details: { ...note, payload },
    event: { type: "proposal.created", data: { ...note, status: "PENDING" } },
    notify,
  });
  return proposal;
}

/**
 * Runs a matured proposal once: claims it (PENDING -> EXECUTED, conditional),
 * then lets its handler re-validate and apply. A reason or a throw moves it
 * to FAILED; SERVICE_UNAVAILABLE (a document that could not be written, the
 * store already reverted) puts it back to PENDING and rethrows, so a later
 * call or the sweeper retries it. The caller holds the org lock.
 */
export async function runProposal(rt: OrgRuntime, proposal: ProposalRecord, actor: string): Promise<ProposalRecord> {
  const store = rt.store();
  const now = rt.now();
  if (proposal.status !== "PENDING") throw notExecutable(`The proposal is ${proposal.status}`);
  // Owners before and after the change are notified: ADD_OWNER, REMOVE_OWNER and DELETE_ORG change who they are.
  const ownersBefore = await activeOwners(rt, proposal.orgId);
  // Only current owners' approvals count, against today's threshold: an owner who
  // left no longer consents, and owners added since must consent too.
  if (!thresholdMet(proposal, ownersBefore)) {
    if (proposal.executableAt) await store.updateProposal(proposal.id, { executableAt: null }, "PENDING");
    throw notExecutable(`The proposal needs ${effectiveThreshold(proposal, ownersBefore)} approvals from current owners`);
  }
  const executableAt = proposal.executableAt;
  if (!executableAt || executableAt.getTime() > now.getTime()) throw notExecutable("The proposal is not executable yet");
  if (executableAt.getTime() >= proposal.expiresAt.getTime()) throw notExecutable("The proposal expired");
  const claimed = await store.updateProposal(proposal.id, { status: "EXECUTED", executedAt: now }, "PENDING");
  if (!claimed) throw notExecutable("The proposal is no longer pending");
  const org = await store.organization(proposal.orgId);
  const handler = PROPOSAL_KINDS[proposal.kind];
  let reason: string | null;
  if (!org || org.archived || org.takenDown) reason = "The organization is archived or taken down";
  else if (!handler) reason = `${proposal.kind} proposals cannot be executed`;
  else {
    try {
      reason = await handler.execute({ rt, org, proposal: claimed, actor, now });
    } catch (error) {
      if (isUnavailable(error)) {
        await store.updateProposal(proposal.id, { status: "PENDING", executedAt: null }, "EXECUTED");
        throw error;
      }
      reason = error instanceof Error ? error.message : String(error);
    }
  }
  const result = reason
    ? ((await store.updateProposal(proposal.id, { status: "FAILED", executedAt: null, reason }, "EXECUTED")) ?? claimed)
    : claimed;
  const owners = [...new Set([...ownersBefore, ...(await activeOwners(rt, proposal.orgId))])];
  const note = { proposalId: proposal.id, kind: proposal.kind, status: result.status };
  await rt.record({
    orgId: proposal.orgId,
    actor,
    action: actor === "system" ? "system.executeOrgProposal" : "executeOrgProposal",
    at: now,
    details: { ...note, reason },
    event: { type: "proposal.executed", data: note },
    notify: ownersNotice("proposal.executed", { ...note, reason }, owners),
  });
  return result;
}

/** Marks an unmatured proposal EXPIRED. The caller holds the org lock. */
export async function expireProposal(rt: OrgRuntime, proposal: ProposalRecord, now: Date): Promise<void> {
  const expired = await rt.store().updateProposal(proposal.id, { status: "EXPIRED", reason: "Expired before it could run" }, "PENDING");
  if (!expired) return;
  const note = { proposalId: proposal.id, kind: proposal.kind, status: "EXPIRED" };
  await rt.record({
    orgId: proposal.orgId,
    actor: "system",
    action: "system.expireOrgProposal",
    at: now,
    details: note,
    event: { type: "proposal.cancelled", data: note },
    notify: ownersNotice("proposal.expired", note),
  });
}

async function proposalOf(rt: OrgRuntime, orgId: string, proposalId: string): Promise<ProposalRecord> {
  const proposal = await rt.store().proposal(proposalId);
  if (!proposal || proposal.orgId !== orgId) throw notFound("Proposal");
  return proposal;
}

/** The caller is an ACTIVE owner of the org, or the proposal's proposer; FORBIDDEN otherwise. */
async function assertOwnerOrProposer(rt: OrgRuntime, proposal: ProposalRecord, caller: string): Promise<void> {
  if (caller === proposal.proposer) return;
  await requireRole(rt.store(), proposal.orgId, caller, "OWNER");
}

type ProposalArgs = OrgArgs & { orgId: string; proposalId: string };

export const proposalResolvers: Area = (rt) => ({
  Query: {
    orgProposals: async (_: unknown, args: OrgArgs & { orgId: string; status?: ProposalStatus | null }, ctx: OrgContext) => {
      const caller = await rt.caller(ctx, "orgProposals", args);
      const store = rt.store();
      await requireOrg(store, args.orgId, { writable: false });
      await requireRole(store, args.orgId, caller, "ADMIN");
      return (await store.proposals(args.orgId, args.status ?? undefined)).map(proposalOutput);
    },
  },
  Mutation: {
    proposeOrgChange: async (
      _: unknown,
      args: OrgArgs & { orgId: string; kind: ProposalKind; payload: ProposalInput },
      ctx: OrgContext,
    ) => {
      const caller = await rt.writer(ctx, "proposeOrgChange", args);
      return rt.lock(`org:${args.orgId}`, async () => {
        const store = rt.store();
        const now = rt.now();
        const org = await requireOrg(store, args.orgId);
        await requireRole(store, org.id, caller, "OWNER");
        const handler = PROPOSAL_KINDS[args.kind];
        if (!handler || !handler.proposable) {
          throw badInput("kind", args.kind === "RECOVER" ? "Recovery starts with startOrgRecovery" : `${args.kind} proposals are not available`);
        }
        const payload = await handler.validate(rt, org, args.payload);
        // Expired-but-unswept proposals no longer count.
        const pending = (await store.proposals(org.id, "PENDING")).filter((p) => isLive(p, now));
        if (pending.length >= MAX_PENDING_PROPOSALS) throw limitReached(`At most ${MAX_PENDING_PROPOSALS} pending proposals`);
        if (pending.some((p) => p.kind === args.kind && canonicalJson(p.payload) === canonicalJson(payload))) {
          throw badInput("payload", "An identical proposal is already pending");
        }
        return proposalOutput(await createProposal(rt, org, args.kind, payload, caller, [caller], now));
      });
    },
    approveOrgProposal: async (_: unknown, args: ProposalArgs, ctx: OrgContext) => {
      const caller = await rt.writer(ctx, "approveOrgProposal", args);
      return rt.lock(`org:${args.orgId}`, async () => {
        const store = rt.store();
        const now = rt.now();
        await requireOrg(store, args.orgId);
        await requireRole(store, args.orgId, caller, "OWNER");
        const proposal = await proposalOf(rt, args.orgId, args.proposalId);
        if (proposal.status !== "PENDING") throw notExecutable(`The proposal is ${proposal.status}`);
        if (!isLive(proposal, now)) throw notExecutable("The proposal expired");
        if (proposal.approvals.includes(caller)) return proposalOutput(proposal);
        const owners = await activeOwners(rt, args.orgId);
        const approvals = [...proposal.approvals, caller];
        const metBefore = thresholdMet(proposal, owners);
        const executableAt = executableAtFor({ ...proposal, approvals }, owners, rt.config(), now, metBefore);
        const updated = await store.updateProposal(proposal.id, { approvals, executableAt }, "PENDING");
        if (!updated) throw notExecutable("The proposal is no longer pending");
        // Reaching the threshold starts the countdown: a state change owners hear about.
        const thresholdReached = !metBefore && executableAt !== null;
        const note = { proposalId: proposal.id, kind: proposal.kind, status: "PENDING", thresholdReached };
        await rt.record({
          orgId: args.orgId,
          actor: caller,
          action: "approveOrgProposal",
          at: now,
          details: { ...note, executableAt: isoOrNull(updated.executableAt) },
          event: { type: "proposal.approved", data: note },
          notify: thresholdReached ? ownersNotice("proposal.approved", { ...note, executableAt: isoOrNull(executableAt) }) : [],
        });
        return proposalOutput(updated);
      });
    },
    cancelOrgProposal: async (_: unknown, args: ProposalArgs, ctx: OrgContext) => {
      const caller = await rt.writer(ctx, "cancelOrgProposal", args);
      return rt.lock(`org:${args.orgId}`, async () => {
        const store = rt.store();
        const now = rt.now();
        await requireOrg(store, args.orgId);
        const proposal = await proposalOf(rt, args.orgId, args.proposalId);
        await assertOwnerOrProposer(rt, proposal, caller);
        if (proposal.status !== "PENDING") throw notExecutable(`The proposal is ${proposal.status}`);
        const cancelled = await store.updateProposal(proposal.id, { status: "CANCELLED", reason: `Cancelled by ${caller}` }, "PENDING");
        if (!cancelled) throw notExecutable("The proposal is no longer pending");
        const note = { proposalId: proposal.id, kind: proposal.kind, status: "CANCELLED" };
        await rt.record({
          orgId: args.orgId,
          actor: caller,
          action: "cancelOrgProposal",
          at: now,
          details: note,
          event: { type: "proposal.cancelled", data: note },
          notify: ownersNotice("proposal.cancelled", note),
        });
        return proposalOutput(cancelled);
      });
    },
    executeOrgProposal: async (_: unknown, args: ProposalArgs, ctx: OrgContext) => {
      const caller = await rt.writer(ctx, "executeOrgProposal", args);
      return rt.lock(`org:${args.orgId}`, async () => {
        const proposal = await proposalOf(rt, args.orgId, args.proposalId);
        try {
          await assertOwnerOrProposer(rt, proposal, caller);
        } catch {
          throw forbidden();
        }
        return proposalOutput(await runProposal(rt, proposal, caller));
      });
    },
  },
});
