import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { NetDeps, PinnedRequest } from "../core/net.js";
import { createSweeper } from "../core/sweeper.js";
import { sweepJobs, webhookDeliveryJob } from "../jobs.js";
import { signatureHeader } from "../core/webhook-delivery.js";
import { ALICE, BOB, createOrg, failure, harnessResolvers, join, openHarness, resetHarness, T0, type Harness, type TestResolvers } from "./harness.js";

vi.mock("../../renown-auth/core/smart-wallet.js", () => ({
  verifyMessageOnChain: () => Promise.resolve(false),
  verifyTypedDataOnChain: () => Promise.resolve(false),
}));

const MINUTE = 60_000;
const KEY = new Uint8Array(32).fill(9);
interface Webhook {
  id: string;
  url: string;
  events: string[];
  enabled: boolean;
  consecutiveFailures: number;
}
interface Delivery {
  id: string;
  eventType: string;
  status: string;
  attempts: number;
  responseStatus: number | null;
  lastError: string | null;
  nextAttemptAt: string | null;
}
let h: Harness;

/** A receiver: every host resolves to `ip`, every request answers `status`. */
function receiver() {
  const state = { ip: "93.184.216.34", status: 200, truncated: false };
  const requests: PinnedRequest[] = [];
  const net: NetDeps = {
    lookup: () => Promise.resolve([{ address: state.ip, family: 4 }]),
    resolveTxt: () => Promise.reject(new Error("ENODATA")),
    request: (request) => {
      requests.push(request);
      return Promise.resolve({ status: state.status, body: new Uint8Array(), truncated: state.truncated });
    },
  };
  return { state, requests, net };
}

beforeAll(async () => {
  h = await openHarness();
});
afterAll(async () => {
  await h.root.destroy();
});
beforeEach(async () => {
  await resetHarness(h);
});

async function endpoint(t: TestResolvers, orgId: string, events = ["member.invited"]) {
  return t.mutate<{ webhook: Webhook; secret: string }>("createOrgWebhook", { orgId, url: "https://hooks.example/renown", events }, ALICE);
}

function sweep(t: TestResolvers) {
  return createSweeper({ jobs: sweepJobs(t.rt), store: () => t.store, now: () => t.clock.now }).tick();
}

describe("webhooks", () => {
  it("shows the secret once, keeps it sealed, and delivers signed events the endpoint subscribed to", async () => {
    const r = receiver();
    const t = harnessResolvers(h, { net: r.net, webhookKey: () => KEY });
    const { id } = await createOrg(t, ALICE, "acme");
    const { webhook, secret } = await endpoint(t, id);
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = await t.store.webhook(webhook.id);
    expect(stored?.secretSealed).toMatch(/^v1\./);
    expect(JSON.stringify(stored)).not.toContain(secret);
    expect(JSON.stringify(await t.store.auditPage(id, 5))).not.toContain(secret);
    await t.mutate("inviteOrgMember", { orgId: id, invitee: BOB.address, role: "MEMBER" }, ALICE);
    await t.mutate("setOrgListed", { orgId: id, listed: true }, ALICE);
    await sweep(t);
    expect(r.requests).toHaveLength(1);
    const [request] = r.requests;
    expect(request).toMatchObject({ method: "POST", address: "93.184.216.34" });
    expect(request.url.href).toBe("https://hooks.example/renown");
    const body = JSON.parse(request.body ?? "") as { id: string; type: string; orgId: string; createdAt: string; data: unknown };
    expect(body).toMatchObject({ type: "member.invited", orgId: id, createdAt: T0.toISOString(), data: { address: BOB.address.toLowerCase(), role: "MEMBER" } });
    const t0 = Math.floor(t.clock.now.getTime() / 1000);
    expect(request.headers["renown-signature"]).toBe(`t=${t0},v1=${createHmac("sha256", secret).update(`${t0}.${request.body}`).digest("hex")}`);
    expect(request.headers["user-agent"]).toBe("Renown-Webhooks/1");
    const [delivery] = await t.query<Delivery[]>("orgWebhookDeliveries", { orgId: id, webhookId: webhook.id }, ALICE);
    expect(delivery).toMatchObject({ eventType: "member.invited", status: "DELIVERED", attempts: 1, responseStatus: 200 });
  });

  it("retries at 1 min, 5 min, 30 min, 2 h and 12 h, then fails; 50 failures in a row disable the endpoint", async () => {
    const r = receiver();
    r.state.status = 500;
    const t = harnessResolvers(h, { net: r.net, webhookKey: () => KEY });
    const { id } = await createOrg(t, ALICE, "acme");
    const { webhook } = await endpoint(t, id);
    await t.mutate("inviteOrgMember", { orgId: id, invitee: BOB.address, role: "MEMBER" }, ALICE);
    const waits: (number | null)[] = [];
    for (const delay of [0, MINUTE, 5 * MINUTE, 30 * MINUTE, 120 * MINUTE, 720 * MINUTE]) {
      t.tick(delay);
      await sweep(t);
      const [d] = await t.store.deliveries(webhook.id, 1);
      waits.push(d.nextAttemptAt ? d.nextAttemptAt.getTime() - t.clock.now.getTime() : null);
    }
    expect(waits).toEqual([MINUTE, 5 * MINUTE, 30 * MINUTE, 120 * MINUTE, 720 * MINUTE, null]);
    expect((await t.store.deliveries(webhook.id, 1))[0]).toMatchObject({ status: "FAILED", attempts: 6, responseStatus: 500 });
    expect((await t.store.webhook(webhook.id))?.consecutiveFailures).toBe(6);
    await t.store.updateWebhook(webhook.id, { consecutiveFailures: 49 }, t.clock.now);
    await t.mutate("testOrgWebhook", { orgId: id, webhookId: webhook.id }, ALICE);
    expect(await t.store.webhook(webhook.id)).toMatchObject({ enabled: false, consecutiveFailures: 50 });
    expect((await t.store.auditPage(id, 1))[0]).toMatchObject({ actor: "system", action: "system.webhookDisabled" });
    expect((await t.mutate<Webhook>("updateOrgWebhook", { orgId: id, webhookId: webhook.id, enabled: true }, ALICE))).toMatchObject({ enabled: true, consecutiveFailures: 0 });
  });

  it("refuses a delivery whose host now resolves privately", async () => {
    const r = receiver();
    const t = harnessResolvers(h, { net: r.net, webhookKey: () => KEY });
    const { id } = await createOrg(t, ALICE, "acme");
    const { webhook } = await endpoint(t, id);
    r.state.ip = "127.0.0.1";
    const ping = await t.mutate<Delivery>("testOrgWebhook", { orgId: id, webhookId: webhook.id }, ALICE);
    expect(ping).toMatchObject({ eventType: "ping", status: "FAILED", attempts: 1, responseStatus: null });
    expect(ping.lastError).toMatch(/non-public/);
    expect(r.requests).toEqual([]);
  });

  it("validates the URL and events, caps endpoints at 10, is for admins and needs the encryption key", async () => {
    const r = receiver();
    const t = harnessResolvers(h, { net: r.net, webhookKey: () => KEY });
    const { id } = await createOrg(t, ALICE, "acme");
    await join(t, id, BOB, "PUBLISHER");
    const create = (url: string, events: string[], who = ALICE) => t.mutate("createOrgWebhook", { orgId: id, url, events }, who);
    expect(await failure(create("http://hooks.example/", ["member.invited"]))).toMatchObject({ field: "url" });
    expect(await failure(create("https://user:pw@hooks.example/", ["member.invited"]))).toMatchObject({ field: "url" });
    expect(await failure(create("https://hooks.example/", []))).toMatchObject({ field: "events" });
    expect(await failure(create("https://hooks.example/", ["member.exploded"]))).toMatchObject({ field: "events" });
    expect((await failure(create("https://hooks.example/", ["member.invited"], BOB))).code).toBe("FORBIDDEN");
    r.state.ip = "10.1.1.1";
    expect(await failure(create("https://hooks.example/", ["member.invited"]))).toMatchObject({ field: "url" });
    r.state.ip = "93.184.216.34";
    for (let i = 0; i < 10; i++) await create(`https://hooks.example/${i}`, ["org.updated"]);
    expect((await failure(create("https://hooks.example/11", ["org.updated"]))).code).toBe("LIMIT_REACHED");
    const keyless = harnessResolvers(h, { net: r.net, webhookKey: () => null });
    expect((await failure(keyless.mutate("createOrgWebhook", { orgId: id, url: "https://h.example/", events: ["org.updated"] }, ALICE))).code).toBe("SERVICE_UNAVAILABLE");
  });

  it("pings once, keeps the newest 100 deliveries, updates and deletes endpoints", async () => {
    const r = receiver();
    const t = harnessResolvers(h, { net: r.net, webhookKey: () => KEY });
    const { id } = await createOrg(t, ALICE, "acme");
    const { webhook } = await endpoint(t, id);
    await t.store.insertDeliveries(
      Array.from({ length: 105 }, (_, i) => ({
        id: `old-${String(i).padStart(3, "0")}`, webhookId: webhook.id, orgId: id, eventId: `e${i}`, eventType: "member.invited", body: "{}",
        status: "DELIVERED" as const, attempts: 1, responseStatus: 200, lastError: null, createdAt: new Date(T0.getTime() - (200 - i) * MINUTE), nextAttemptAt: null, deliveredAt: T0,
      })),
    );
    expect(await t.mutate<Delivery>("testOrgWebhook", { orgId: id, webhookId: webhook.id }, ALICE)).toMatchObject({ eventType: "ping", status: "DELIVERED" });
    const kept = await t.store.deliveries(webhook.id, 500);
    expect(kept).toHaveLength(100);
    expect(kept[0].eventType).toBe("ping");
    expect((await t.mutate<Webhook>("updateOrgWebhook", { orgId: id, webhookId: webhook.id, events: ["org.updated", "org.updated"] }, ALICE)).events).toEqual(["org.updated"]);
    expect((await t.query<Webhook[]>("orgWebhooks", { orgId: id }, ALICE)).map((w) => w.events)).toEqual([["org.updated"]]);
    expect(await t.mutate("deleteOrgWebhook", { orgId: id, webhookId: webhook.id }, ALICE)).toBe(true);
    expect(await t.store.deliveries(webhook.id, 10)).toEqual([]);
    expect((await failure(t.query("orgWebhookDeliveries", { orgId: id, webhookId: webhook.id }, ALICE))).code).toBe("NOT_FOUND");
  });

  it("signs the pinned vector (shared with the SDK's verifyWebhookSignature)", () => {
    const body = '{"id":"e1","type":"ping","orgId":"o1","createdAt":"2026-10-12T12:00:00.000Z","data":{}}';
    expect(signatureHeader("whsec-test", body, new Date("2026-10-12T12:00:00.000Z"))).toBe(
      "t=1791806400,v1=d75d85f23b7a86faf73cdd020c6fa4436f53a1b646e17bc80d97e2299b4f4d17",
    );
  });

  it("allows ports 443 and 8443 only, sends with a 10 s deadline and a 4 KiB response cap, and tolerates a larger response", async () => {
    const r = receiver();
    const t = harnessResolvers(h, { net: r.net, webhookKey: () => KEY });
    const { id } = await createOrg(t, ALICE, "acme");
    const create = (url: string) => t.mutate<{ webhook: Webhook }>("createOrgWebhook", { orgId: id, url, events: ["org.updated"] }, ALICE);
    for (const url of ["https://hooks.example:8080/", "https://hooks.example:22/", "https://hooks.example:80/"]) {
      expect(await failure(create(url))).toMatchObject({ field: "url" });
    }
    await create("https://hooks.example:443/a");
    const { webhook } = await create("https://hooks.example:8443/b");
    expect(webhook.url).toBe("https://hooks.example:8443/b");
    r.state.truncated = true;
    expect(await t.mutate<Delivery>("testOrgWebhook", { orgId: id, webhookId: webhook.id }, ALICE)).toMatchObject({ status: "DELIVERED", responseStatus: 200 });
    expect(r.requests[0]).toMatchObject({ maxBytes: 4096 });
    expect(r.requests[0].timeoutMs).toBeGreaterThan(9_000);
    expect(r.requests[0].timeoutMs).toBeLessThanOrEqual(10_000);
  });

  it("never returns or audits the secret, and an enqueue failure never fails the mutation", async () => {
    const r = receiver();
    const t = harnessResolvers(h, { net: r.net, webhookKey: () => KEY });
    const { id } = await createOrg(t, ALICE, "acme");
    const { webhook, secret } = await endpoint(t, id);
    expect(JSON.stringify(await t.query("orgWebhooks", { orgId: id }, ALICE))).not.toContain(secret);
    expect(JSON.stringify(await t.query("orgWebhooks", { orgId: id }, ALICE))).not.toContain(webhook.id + "\"secret");
    const spy = vi.spyOn(t.store, "insertDeliveries").mockRejectedValueOnce(new Error("db down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(t.mutate("inviteOrgMember", { orgId: id, invitee: BOB.address, role: "MEMBER" }, ALICE)).resolves.toBeTruthy();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("db down"));
    expect(log.mock.calls.flat().join(" ")).not.toContain(secret);
    spy.mockRestore();
    log.mockRestore();
    expect(await t.store.deliveries(webhook.id, 10)).toEqual([]);
  });

  it("sends a due delivery once even when two runs (replicas) race for it", async () => {
    const r = receiver();
    const t = harnessResolvers(h, { net: r.net, webhookKey: () => KEY });
    const { id } = await createOrg(t, ALICE, "acme");
    const { webhook } = await endpoint(t, id);
    await t.mutate("inviteOrgMember", { orgId: id, invitee: BOB.address, role: "MEMBER" }, ALICE);
    const job = webhookDeliveryJob(t.rt);
    await Promise.all([job.run(t.clock.now, null), job.run(t.clock.now, null)]);
    expect(r.requests).toHaveLength(1);
    expect((await t.store.deliveries(webhook.id, 1))[0]).toMatchObject({ status: "DELIVERED", attempts: 1 });
  });

  it("retries a delivery whose attempt was interrupted after its claim lapsed, and fails one that used every attempt", async () => {
    const r = receiver();
    const t = harnessResolvers(h, { net: r.net, webhookKey: () => KEY });
    const { id } = await createOrg(t, ALICE, "acme");
    const { webhook } = await endpoint(t, id);
    await t.mutate("inviteOrgMember", { orgId: id, invitee: BOB.address, role: "MEMBER" }, ALICE);
    const [queued] = await t.store.deliveries(webhook.id, 1);
    // A replica claimed it and died mid-send.
    await t.store.claimDelivery(queued.id, queued.nextAttemptAt, new Date(t.clock.now.getTime() + 5 * MINUTE));
    const job = webhookDeliveryJob(t.rt);
    await job.run(t.clock.now, null);
    expect(r.requests).toHaveLength(0);
    t.tick(5 * MINUTE);
    await job.run(t.clock.now, null);
    expect(r.requests).toHaveLength(1);
    expect((await t.store.deliveries(webhook.id, 1))[0]).toMatchObject({ status: "DELIVERED", attempts: 2 });
    await t.store.insertDeliveries([
      { id: "spent", webhookId: webhook.id, orgId: id, eventId: "e", eventType: "member.invited", body: "{}", status: "PENDING", attempts: 6,
        responseStatus: null, lastError: null, createdAt: t.clock.now, nextAttemptAt: t.clock.now, deliveredAt: null },
    ]);
    await job.run(t.clock.now, null);
    expect(r.requests).toHaveLength(1);
    expect((await t.store.deliveries(webhook.id, 1))[0]).toMatchObject({ id: "spent", status: "FAILED", attempts: 6 });
  });
});
