import { createHmac } from "node:crypto";
import { open } from "../../renown-workload/core/crypto.js";
import type { OrgRuntime } from "../runtime.js";
import type { DeliveryRecord } from "../store/types.js";
import { guardedRequest } from "./net.js";

/** Waits before the 2nd … 6th attempt (spec §3.9). */
export const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000] as const;
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
export const AUTO_DISABLE_AFTER = 50;
export const KEEP_DELIVERIES = 100;
export const MAX_WEBHOOKS = 10;
/** One deadline for DNS, connect and response of an attempt. */
export const DELIVERY_TIMEOUT_MS = 10_000;
/** Response bytes read; the rest of a larger body is discarded (only the status matters). */
export const DELIVERY_MAX_RESPONSE_BYTES = 4096;
/** Ports a webhook URL may name: the HTTPS default and its common alternative, never an internal service's. */
export const WEBHOOK_PORTS: readonly number[] = [443, 8443];
/**
 * How long a claimed delivery is withheld from other runs. Far longer than an
 * attempt can take; a run that dies mid-send leaves it to be retried after.
 */
export const CLAIM_LEASE_MS = 5 * 60_000;

/** The exact JSON a delivery sends (and signs). */
export function eventBody(event: { id: string; type: string; orgId: string; createdAt: Date; data: Record<string, unknown> }): string {
  return JSON.stringify({ id: event.id, type: event.type, orgId: event.orgId, createdAt: event.createdAt.toISOString(), data: event.data });
}

/** Renown-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>. */
export function signatureHeader(secret: string, body: string, at: Date): string {
  const t = Math.floor(at.getTime() / 1000);
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * One delivery attempt; a taken-down organisation's is PAUSED instead. It
 * claims the delivery first (compare-and-set on its next_attempt_at,
 * counting the attempt), so two runs never send it twice;
 * undefined when another run has it. Then it signs the stored body with the
 * endpoint's secret and POSTs it through the SSRF guard (https, public
 * addresses only, ports 443/8443, no redirects, 10 s, 4 KiB read). A 2xx
 * delivers; anything else is a failed attempt, retried on the backoff
 * schedule when `retry` (else FAILED at once). It counts the endpoint's
 * consecutive failures, disables it at 50 (audited once), and keeps the
 * newest 100 settled deliveries. A failed send never throws; store errors do.
 */
export async function attemptDelivery(rt: OrgRuntime, delivery: DeliveryRecord, options: { retry: boolean }): Promise<DeliveryRecord | undefined> {
  const store = rt.store();
  const webhook = await store.webhook(delivery.webhookId);
  if (!webhook || !webhook.enabled) {
    return store.updateDelivery(delivery.id, { status: "FAILED", lastError: "The endpoint is disabled", nextAttemptAt: null });
  }
  if ((await store.organization(webhook.orgId))?.takenDown !== false) {
    // Queued around the takedown (spec §3.11): held until the organisation is restored.
    return store.updateDelivery(delivery.id, { status: "PAUSED" });
  }
  if (delivery.attempts >= MAX_ATTEMPTS) {
    // Its last attempt was interrupted after the claim.
    return store.updateDelivery(delivery.id, { status: "FAILED", lastError: delivery.lastError ?? "The last attempt was interrupted", nextAttemptAt: null });
  }
  const claimed = await store.claimDelivery(delivery.id, delivery.nextAttemptAt, new Date(rt.now().getTime() + CLAIM_LEASE_MS));
  if (!claimed) return undefined;
  const now = rt.now();
  let status: number | null = null;
  let error: string | null = null;
  const key = rt.webhookKey();
  if (!key) {
    error = "Webhook secrets cannot be opened (no encryption key)";
  } else {
    try {
      const secret = await open(key, webhook.secretSealed, webhook.id);
      const response = await guardedRequest(rt.net(), webhook.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "Renown-Webhooks/1",
          "renown-signature": signatureHeader(secret, claimed.body, now),
        },
        body: claimed.body,
        timeoutMs: DELIVERY_TIMEOUT_MS,
        maxBytes: DELIVERY_MAX_RESPONSE_BYTES,
        truncate: true,
        ports: WEBHOOK_PORTS,
      });
      status = response.status;
      if (status < 200 || status >= 300) error = `HTTP ${status}`;
    } catch (cause) {
      error = describe(cause);
    }
  }
  const attempts = claimed.attempts;
  let updated: DeliveryRecord | undefined;
  if (error === null) {
    updated = await store.updateDelivery(claimed.id, { status: "DELIVERED", responseStatus: status, lastError: null, nextAttemptAt: null, deliveredAt: now });
    await store.resetWebhookFailures(webhook.id, now);
  } else {
    const done = !options.retry || attempts >= MAX_ATTEMPTS;
    updated = await store.updateDelivery(claimed.id, {
      status: done ? "FAILED" : "PENDING",
      responseStatus: status,
      lastError: error.slice(0, 500),
      nextAttemptAt: done ? null : new Date(now.getTime() + RETRY_DELAYS_MS[attempts - 1]),
    });
    const counted = await store.incrementWebhookFailures(webhook.id, now);
    if (counted && counted.consecutiveFailures >= AUTO_DISABLE_AFTER && (await store.disableWebhook(webhook.id, now))) {
      // record never throws.
      await rt.record({
        orgId: webhook.orgId,
        actor: "system",
        action: "system.webhookDisabled",
        at: now,
        details: { webhookId: webhook.id, consecutiveFailures: counted.consecutiveFailures },
      });
    }
  }
  await store.pruneDeliveries(webhook.id, KEEP_DELIVERIES);
  return updated;
}
