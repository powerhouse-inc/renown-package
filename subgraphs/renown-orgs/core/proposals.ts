import type { OrgRuntime } from "../runtime.js";
import type { OrgRecord, PartyKind, ProposalKind, ProposalPayload, ProposalRecord } from "../store/types.js";
import type { OrgNotificationIntent, OrgNotificationKind } from "./activity.js";
import type { OrgsConfig } from "./config.js";

/** Proposals expire 14 days after they were made. */
export const PROPOSAL_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const MAX_PENDING_PROPOSALS = 20;

/** The timelock of a kind: 0 for freezes, the recovery delay for RECOVER, the timelock otherwise. */
export function delayMs(kind: ProposalKind, config: OrgsConfig): number {
  if (kind === "FREEZE_APP" || kind === "UNFREEZE_APP") return 0;
  return (kind === "RECOVER" ? config.recoverySeconds : config.timelockSeconds) * 1000;
}

/** Owner approvals needed: min(2, owners), none for RECOVER. */
export function thresholdFor(kind: ProposalKind, owners: number): number {
  return kind === "RECOVER" ? 0 : Math.min(2, owners);
}

/**
 * The approvals needed now: never below what was needed when proposed, and
 * at least min(2, current owners), so owners added since then must consent
 * too (RECOVER: 0).
 */
export function effectiveThreshold(proposal: Pick<ProposalRecord, "kind" | "threshold">, owners: readonly string[]): number {
  return proposal.kind === "RECOVER" ? 0 : Math.max(proposal.threshold, thresholdFor(proposal.kind, owners.length));
}

/** The approvals that still count: those of current ACTIVE owners. */
export function validApprovals(proposal: Pick<ProposalRecord, "approvals">, owners: readonly string[]): string[] {
  return proposal.approvals.filter((address) => owners.includes(address));
}

/** Whether the current owners' approvals reach the effective threshold. */
export function thresholdMet(proposal: Pick<ProposalRecord, "kind" | "threshold" | "approvals">, owners: readonly string[]): boolean {
  return validApprovals(proposal, owners).length >= effectiveThreshold(proposal, owners);
}

/**
 * When the proposal may run, given the current active `owners`: null while
 * their approvals are below the effective threshold; kept once set while
 * the threshold stays met; max(createdAt + delay, now) when it is reached now.
 * `metBefore` says whether it was already met before this change.
 */
export function executableAtFor(
  proposal: Pick<ProposalRecord, "kind" | "createdAt" | "approvals" | "threshold" | "executableAt">,
  owners: readonly string[],
  config: OrgsConfig,
  now: Date,
  metBefore = true,
): Date | null {
  if (!thresholdMet(proposal, owners)) return null;
  if (proposal.executableAt && metBefore) return proposal.executableAt;
  return new Date(Math.max(proposal.createdAt.getTime() + delayMs(proposal.kind, config), now.getTime()));
}

/** The GraphQL payload input. */
export interface ProposalInput {
  address?: string | null;
  demoteToAdmin?: boolean | null;
  appDid?: string | null;
  toKind?: PartyKind | null;
  toId?: string | null;
  handle?: string | null;
}

export interface ExecuteContext {
  rt: OrgRuntime;
  org: OrgRecord;
  proposal: ProposalRecord;
  /** The executing owner or proposer, or "system" (the sweeper). */
  actor: string;
  now: Date;
}

export interface ProposalHandler {
  /** False for kinds only a dedicated mutation starts (RECOVER). */
  proposable: boolean;
  /** Normalizes and checks the payload when proposed; throws a GraphQLError (usually field "payload"). */
  validate(rt: OrgRuntime, org: OrgRecord, input: ProposalInput): Promise<ProposalPayload>;
  /** Re-validates and applies the change; returns why it cannot run (the proposal FAILs), or null when done. */
  execute(ctx: ExecuteContext): Promise<string | null>;
}

/** The proposal state changes owners hear about (the webhook event names, plus expiry). */
export type ProposalNoticeEvent =
  | "proposal.created"
  | "proposal.approved"
  | "proposal.executed"
  | "proposal.cancelled"
  | "proposal.expired";

/**
 * The notification kind of each proposal state change. "proposal.approved"
 * (the threshold was reached and the countdown started) has no §3.10 kind
 * yet: A3 decides whether owners are notified of it.
 */
const PROPOSAL_NOTICE_KINDS: Record<ProposalNoticeEvent, OrgNotificationKind | null> = {
  "proposal.created": "PROPOSAL_CREATED",
  "proposal.approved": null,
  "proposal.executed": "PROPOSAL_EXECUTED",
  "proposal.cancelled": "PROPOSAL_CANCELLED",
  "proposal.expired": "PROPOSAL_CANCELLED",
};

/**
 * The owners' notifications of a proposal state change (spec §3.5: every one
 * goes to all active owners). They travel as notify intents on the recorded
 * activity; A3's notification sink stores them, so this is the one place A3
 * hooks in. `to` names the owners explicitly when the change itself alters
 * who they are.
 */
export function ownersNotice(
  event: ProposalNoticeEvent,
  payload: Record<string, unknown>,
  to: OrgNotificationIntent["to"] = "OWNERS",
): OrgNotificationIntent[] {
  const kind = PROPOSAL_NOTICE_KINDS[event];
  return kind ? [{ to, kind, payload: { ...payload, event } }] : [];
}
