import type { OrgStore } from "../store/types.js";

/** Webhook event types (A3 delivers them). */
export const ORG_WEBHOOK_EVENTS = [
  "member.invited",
  "member.joined",
  "member.left",
  "member.removed",
  "member.role_changed",
  "team.changed",
  "app.transferred_in",
  "app.transferred_out",
  "app.frozen",
  "app.unfrozen",
  "credential.suspended",
  "proposal.created",
  "proposal.approved",
  "proposal.cancelled",
  "proposal.executed",
  "domain.verified",
  "domain.lapsed",
  "release.attested",
  "org.updated",
] as const;
export type OrgWebhookEventType = (typeof ORG_WEBHOOK_EVENTS)[number];

/** In-app notification kinds (A3 stores them). */
export const ORG_NOTIFICATION_KINDS = [
  "INVITED",
  "INVITE_ACCEPTED",
  "ROLE_CHANGED",
  "REMOVED",
  "PROPOSAL_CREATED",
  "PROPOSAL_NEEDS_APPROVAL",
  "PROPOSAL_EXECUTED",
  "PROPOSAL_CANCELLED",
  "RECOVERY_STARTED",
  "APP_TRANSFER_REQUEST",
  "APP_TRANSFER_DONE",
  "APP_FROZEN",
  "DOMAIN_LAPSED",
  "DELEGATION_ADDED",
] as const;
export type OrgNotificationKind = (typeof ORG_NOTIFICATION_KINDS)[number];

/** Who gets a notification: explicit lowercase addresses, or the org's active owners/admins (admins include owners). */
export interface OrgNotificationIntent {
  to: readonly string[] | "OWNERS" | "ADMINS";
  kind: OrgNotificationKind;
  payload?: Record<string, unknown>;
}

/** One successful org mutation or system action. */
export interface OrgActivity {
  orgId: string;
  /** Lowercase address, or "system". */
  actor: string;
  /** The GraphQL field, or system.<what> for sweeper actions. */
  action: string;
  at: Date;
  /** Audit details; never tokens, secrets or signatures. */
  details?: Record<string, unknown>;
  event?: { type: OrgWebhookEventType; data: Record<string, unknown> };
  notify?: readonly OrgNotificationIntent[];
}

export interface RecordedActivity extends OrgActivity {
  /** The audit row id, also the webhook event id. */
  id: string;
}

/** Receives every recorded activity after its audit row (A3: notifications, webhooks). */
export type ActivitySink = (activity: RecordedActivity) => Promise<void>;

/**
 * Writes the audit row, then hands the activity to each sink. Never throws:
 * the change it describes is already applied, so a failed audit or sink
 * write is logged and the mutation still succeeds.
 */
export function createActivityRecorder(deps: {
  store: () => OrgStore;
  newId: () => string;
  sinks: readonly ActivitySink[];
  log?: (message: string) => void;
}): (activity: OrgActivity) => Promise<void> {
  const log = deps.log ?? ((message: string) => console.error(message));
  return async (activity) => {
    const recorded: RecordedActivity = { ...activity, id: deps.newId() };
    try {
      await deps.store().appendAudit({
        id: recorded.id,
        orgId: activity.orgId,
        at: activity.at,
        actor: activity.actor,
        action: activity.action,
        details: activity.details ?? {},
      });
    } catch (error) {
      log(`[renown-orgs] audit write for ${activity.action} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    for (const sink of deps.sinks) {
      try {
        await sink(recorded);
      } catch (error) {
        log(`[renown-orgs] activity sink for ${activity.action} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };
}
