import { isIP } from "node:net";
import { seal } from "../../renown-workload/core/crypto.js";
import { ORG_WEBHOOK_EVENTS, type ActivitySink } from "../core/activity.js";
import type { OrgArgs, OrgContext } from "../core/auth.js";
import { requireOrg, requireRole } from "../core/authz.js";
import { badInput, limitReached, notFound, unavailable } from "../core/errors.js";
import { isPublicAddress } from "../core/net.js";
import { attemptDelivery, eventBody, MAX_WEBHOOKS, WEBHOOK_PORTS } from "../core/webhook-delivery.js";
import { iso, isoOrNull } from "../output.js";
import type { Area, OrgRuntime } from "../runtime.js";
import type { DeliveryRecord, WebhookRecord } from "../store/types.js";

const MAX_URL_LENGTH = 2048;
const KNOWN_EVENTS: ReadonlySet<string> = new Set(ORG_WEBHOOK_EVENTS);

/** Never includes the secret. */
function webhookOutput(w: WebhookRecord) {
  return { id: w.id, orgId: w.orgId, url: w.url, events: [...w.events], enabled: w.enabled, consecutiveFailures: w.consecutiveFailures, createdAt: iso(w.createdAt) };
}

function deliveryOutput(d: DeliveryRecord) {
  return {
    id: d.id,
    webhookId: d.webhookId,
    eventId: d.eventId,
    eventType: d.eventType,
    status: d.status,
    attempts: d.attempts,
    responseStatus: d.responseStatus,
    lastError: d.lastError,
    createdAt: iso(d.createdAt),
    nextAttemptAt: isoOrNull(d.nextAttemptAt),
    deliveredAt: isoOrNull(d.deliveredAt),
  };
}

/** The URL without query and fragment, for the audit log (they may carry the receiver's own tokens). */
function auditUrl(url: string): string {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname}`;
}

/**
 * An https URL without credentials, on port 443 or 8443, whose host resolves
 * only to public addresses; BAD_USER_INPUT (field url) otherwise. Every
 * delivery checks the addresses again (the host may move).
 */
async function webhookUrl(rt: OrgRuntime, raw: string): Promise<string> {
  const value = raw.trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw badInput("url", "url must be an https URL");
  }
  if (url.protocol !== "https:" || url.username || url.password || value.length > MAX_URL_LENGTH) {
    throw badInput("url", `url must be an https URL of at most ${MAX_URL_LENGTH} characters, without credentials`);
  }
  if (!WEBHOOK_PORTS.includes(url.port ? Number(url.port) : 443)) throw badInput("url", `url must use port ${WEBHOOK_PORTS.join(" or ")}`);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : (await rt.net().lookup(host)).map((entry) => entry.address);
  } catch {
    throw badInput("url", `${host} does not resolve`);
  }
  if (addresses.length === 0 || !addresses.every(isPublicAddress)) throw badInput("url", `${host} must resolve to public addresses only`);
  return url.toString();
}

function eventsArg(values: readonly string[]): string[] {
  const events = [...new Set(values.map((value) => value.trim()))];
  if (events.length === 0 || !events.every((event) => KNOWN_EVENTS.has(event))) {
    throw badInput("events", `events must be a non-empty list of: ${[...KNOWN_EVENTS].join(", ")}`);
  }
  return events;
}

function requireKey(rt: OrgRuntime): Uint8Array {
  const key = rt.webhookKey();
  if (!key) throw unavailable("Webhooks are not available (no encryption key)");
  return key;
}

/**
 * Queues a delivery for every enabled endpoint of the organisation subscribed
 * to the activity's event. A failure is logged by the activity recorder; it
 * never fails the mutation.
 */
export function webhookSink(rt: OrgRuntime): ActivitySink {
  return async (activity) => {
    const event = activity.event;
    if (!event) return;
    const store = rt.store();
    const hooks = (await store.webhooks(activity.orgId)).filter((w) => w.enabled && w.events.includes(event.type));
    if (hooks.length === 0) return;
    const body = eventBody({ id: activity.id, type: event.type, orgId: activity.orgId, createdAt: activity.at, data: event.data });
    await store.insertDeliveries(
      hooks.map((w) => ({
        id: rt.newId(),
        webhookId: w.id,
        orgId: activity.orgId,
        eventId: activity.id,
        eventType: event.type,
        body,
        status: "PENDING",
        attempts: 0,
        responseStatus: null,
        lastError: null,
        createdAt: activity.at,
        nextAttemptAt: activity.at,
        deliveredAt: null,
      })),
    );
  };
}

/** Runtimes whose webhook sink is registered. */
const registered = new WeakSet<OrgRuntime>();

/** Adds the webhook sink to `rt` once (resolvers and sweep jobs both record events). */
export function registerWebhookSink(rt: OrgRuntime): void {
  if (registered.has(rt)) return;
  registered.add(rt);
  rt.sinks.push(webhookSink(rt));
}

/** The endpoint of `orgId` for an ADMIN caller, or NOT_FOUND / FORBIDDEN. */
async function adminWebhook(rt: OrgRuntime, orgId: string, caller: string, webhookId: string, writable = true): Promise<WebhookRecord> {
  const store = rt.store();
  await requireOrg(store, orgId, { writable });
  await requireRole(store, orgId, caller, "ADMIN");
  const webhook = await store.webhook(webhookId);
  if (!webhook || webhook.orgId !== orgId) throw notFound("Webhook");
  return webhook;
}

export const webhookResolvers: Area = (rt) => {
  registerWebhookSink(rt);
  return {
    Query: {
      orgWebhooks: async (_: unknown, args: OrgArgs & { orgId: string }, ctx: OrgContext) => {
        const caller = await rt.caller(ctx, "orgWebhooks", args);
        const store = rt.store();
        await requireOrg(store, args.orgId, { writable: false });
        await requireRole(store, args.orgId, caller, "ADMIN");
        return (await store.webhooks(args.orgId)).map(webhookOutput);
      },
      orgWebhookDeliveries: async (_: unknown, args: OrgArgs & { orgId: string; webhookId: string; limit?: number | null }, ctx: OrgContext) => {
        const caller = await rt.caller(ctx, "orgWebhookDeliveries", args);
        const limit = args.limit ?? 20;
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw badInput("limit", "limit must be an integer from 1 to 100");
        const webhook = await adminWebhook(rt, args.orgId, caller, args.webhookId, false);
        return (await rt.store().deliveries(webhook.id, limit)).map(deliveryOutput);
      },
    },
    Mutation: {
      createOrgWebhook: async (_: unknown, args: OrgArgs & { orgId: string; url: string; events: string[] }, ctx: OrgContext) => {
        const caller = await rt.writer(ctx, "createOrgWebhook", args);
        const events = eventsArg(args.events);
        const url = await webhookUrl(rt, args.url);
        return rt.lock(`org:${args.orgId}`, async () => {
          const store = rt.store();
          const now = rt.now();
          await requireOrg(store, args.orgId);
          await requireRole(store, args.orgId, caller, "ADMIN");
          const key = requireKey(rt);
          if ((await store.webhooks(args.orgId)).length >= MAX_WEBHOOKS) throw limitReached(`At most ${MAX_WEBHOOKS} webhooks`);
          const id = rt.newId();
          // 32 random bytes, base64url; shown once, stored only sealed.
          const secret = rt.token(32);
          const webhook: WebhookRecord = {
            id,
            orgId: args.orgId,
            url,
            events,
            secretSealed: await seal(key, secret, id),
            enabled: true,
            consecutiveFailures: 0,
            createdAt: now,
            updatedAt: now,
          };
          await store.insertWebhook(webhook);
          await rt.record({ orgId: args.orgId, actor: caller, action: "createOrgWebhook", at: now, details: { webhookId: id, url: auditUrl(url), events } });
          return { webhook: webhookOutput(webhook), secret };
        });
      },
      updateOrgWebhook: async (
        _: unknown,
        args: OrgArgs & { orgId: string; webhookId: string; url?: string | null; events?: string[] | null; enabled?: boolean | null },
        ctx: OrgContext,
      ) => {
        const caller = await rt.writer(ctx, "updateOrgWebhook", args);
        const url = args.url != null ? await webhookUrl(rt, args.url) : undefined;
        const events = args.events != null ? eventsArg(args.events) : undefined;
        return rt.lock(`org:${args.orgId}`, async () => {
          const now = rt.now();
          const webhook = await adminWebhook(rt, args.orgId, caller, args.webhookId);
          const enabled = args.enabled ?? undefined;
          const updated = await rt.store().updateWebhook(
            webhook.id,
            {
              ...(url !== undefined && { url }),
              ...(events !== undefined && { events }),
              ...(enabled !== undefined && { enabled }),
              ...(enabled === true && { consecutiveFailures: 0 }),
            },
            now,
          );
          if (!updated) throw notFound("Webhook");
          await rt.record({
            orgId: args.orgId,
            actor: caller,
            action: "updateOrgWebhook",
            at: now,
            details: { webhookId: webhook.id, ...(url !== undefined && { url: auditUrl(url) }), ...(events !== undefined && { events }), ...(enabled !== undefined && { enabled }) },
          });
          return webhookOutput(updated);
        });
      },
      deleteOrgWebhook: async (_: unknown, args: OrgArgs & { orgId: string; webhookId: string }, ctx: OrgContext) => {
        const caller = await rt.writer(ctx, "deleteOrgWebhook", args);
        return rt.lock(`org:${args.orgId}`, async () => {
          const webhook = await adminWebhook(rt, args.orgId, caller, args.webhookId);
          await rt.store().deleteWebhook(webhook.id);
          await rt.record({ orgId: args.orgId, actor: caller, action: "deleteOrgWebhook", at: rt.now(), details: { webhookId: webhook.id } });
          return true;
        });
      },
      testOrgWebhook: async (_: unknown, args: OrgArgs & { orgId: string; webhookId: string }, ctx: OrgContext) => {
        const caller = await rt.writer(ctx, "testOrgWebhook", args);
        const webhook = await adminWebhook(rt, args.orgId, caller, args.webhookId);
        requireKey(rt);
        const now = rt.now();
        const id = rt.newId();
        // Unscheduled (nextAttemptAt null), so no sweep takes it before this call claims it; one attempt, no retries.
        const ping: DeliveryRecord = {
          id,
          webhookId: webhook.id,
          orgId: webhook.orgId,
          eventId: id,
          eventType: "ping",
          body: eventBody({ id, type: "ping", orgId: webhook.orgId, createdAt: now, data: {} }),
          status: "PENDING",
          attempts: 0,
          responseStatus: null,
          lastError: null,
          createdAt: now,
          nextAttemptAt: null,
          deliveredAt: null,
        };
        const store = rt.store();
        await store.insertDeliveries([ping]);
        const result = await attemptDelivery(rt, ping, { retry: false });
        if (!result) throw unavailable();
        return deliveryOutput(result);
      },
    },
  };
};
