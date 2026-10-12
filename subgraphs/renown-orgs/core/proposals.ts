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

/** When the proposal may run: kept once set; null while approvals are below the threshold. */
export function executableAtFor(
  proposal: Pick<ProposalRecord, "kind" | "createdAt" | "approvals" | "threshold" | "executableAt">,
  config: OrgsConfig,
  now: Date,
): Date | null {
  if (proposal.executableAt) return proposal.executableAt;
  if (proposal.approvals.length < proposal.threshold) return null;
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

/**
 * The notification of a proposal state change: every one goes to all active
 * owners (spec §3.5). It travels as a notify intent on the recorded activity;
 * A3's notification sink is what stores it, so this is the one place A3 hooks in.
 * `to` names the owners explicitly when the change itself alters who they are.
 */
export function ownersNotice(
  kind: OrgNotificationKind,
  payload: Record<string, unknown>,
  to: OrgNotificationIntent["to"] = "OWNERS",
): OrgNotificationIntent {
  return { to, kind, payload };
}
