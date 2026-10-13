import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RenownOrganizationState } from "../../../document-models/renown-organization/index.js";
import { createClientDirectory, createOrgClientOwners } from "../../renown-oidc/directories.js";
import { KyselyOidcStore } from "../../renown-oidc/store/kysely.js";
import type { NetDeps, PinnedRequest } from "../core/net.js";
import { createSweeper } from "../core/sweeper.js";
import { sweepJobs } from "../jobs.js";
import type { OrganizationOutput } from "../output.js";
import type { ProposalOutput } from "../areas/proposals.js";
import { AUDIT_EXPORT_MAX, AUDIT_EXPORTS_PER_HOUR } from "../areas/moderation.js";
import { registrableDomainNames } from "../core/handles.js";
import { ALICE, BOB, CAROL, DAVE, EVE, createOrg, failure, harnessResolvers, join, lower, OIDC_NS, openHarness, resetHarness, T0, type Harness, type TestResolvers } from "./harness.js";

vi.mock("../../renown-auth/core/smart-wallet.js", () => ({
  verifyMessageOnChain: () => Promise.resolve(false),
  verifyTypedDataOnChain: () => Promise.resolve(false),
}));

const HOUR = 3_600_000;
const KEY = new Uint8Array(32).fill(9);
interface Report {
  id: string;
  orgId: string;
  org: { handle: string } | null;
  reporter: string;
  reason: string;
  status: string;
  resolution: string | null;
  resolvedBy: string | null;
}
let h: Harness;

beforeAll(async () => {
  h = await openHarness();
});
afterAll(async () => {
  await h.root.destroy();
});
beforeEach(async () => {
  await resetHarness(h);
});

const report = (t: TestResolvers, orgId: string, who = BOB, details: string | null = "Looks like a fake") =>
  t.mutate<boolean>("reportOrganization", { orgId, reason: "IMPERSONATION", details }, who);
const resolve = (t: TestResolvers, reportId: string, resolution: string, who = EVE) =>
  t.mutate<Report>("resolveOrgReport", { reportId, resolution, note: "checked" }, who);

/** A webhook receiver answering 200 to everything. */
function receiver() {
  const requests: PinnedRequest[] = [];
  const net: NetDeps = {
    lookup: () => Promise.resolve([{ address: "93.184.216.34", family: 4 }]),
    resolveTxt: () => Promise.reject(new Error("ENODATA")),
    request: (request) => {
      requests.push(request);
      return Promise.resolve({ status: 200, body: new Uint8Array(), truncated: false });
    },
  };
  return { requests, net };
}

describe("reports", () => {
  it("takes reports from anyone signed in, at most 5 a day each, visible to platform admins only", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    for (let i = 0; i < 5; i++) expect(await report(t, id)).toBe(true);
    expect((await failure(report(t, id))).code).toBe("RATE_LIMITED");
    expect(await failure(report(t, id, CAROL, "x".repeat(1001)))).toMatchObject({ field: "details" });
    expect((await failure(report(t, "nope", CAROL))).code).toBe("NOT_FOUND");
    expect((await failure(t.mutate("reportOrganization", { orgId: id, reason: "SPAM" }))).code).toBe("FORBIDDEN");
    expect((await failure(t.query("orgReports", {}, ALICE))).code).toBe("FORBIDDEN");
    const open = await t.query<Report[]>("orgReports", { status: "OPEN" }, EVE);
    expect(open).toHaveLength(5);
    expect(open[0]).toMatchObject({ orgId: id, org: { handle: "acme" }, reporter: lower(BOB), reason: "IMPERSONATION", status: "OPEN" });
    // Non-admins learn nothing, not even whether a report exists.
    expect((await failure(resolve(t, open[0].id, "DISMISS", ALICE))).code).toBe("FORBIDDEN");
    expect((await failure(resolve(t, "nope", "DISMISS", ALICE))).code).toBe("FORBIDDEN");
    expect((await failure(resolve(t, "nope", "DISMISS"))).code).toBe("NOT_FOUND");
    expect((await t.store.auditPage(id, 10)).some((e) => e.action === "reportOrganization")).toBe(false);
    t.tick(24 * HOUR + 1);
    expect(await report(t, id)).toBe(true);
  });

  it("takes an organisation down and restores it, auditing each resolution on the org", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme", { listed: true });
    await report(t, id);
    const [first] = await t.query<Report[]>("orgReports", { status: "OPEN" }, EVE);
    expect(await resolve(t, first.id, "TAKE_DOWN")).toMatchObject({ status: "RESOLVED", resolution: "TAKE_DOWN", resolvedBy: lower(EVE) });
    expect(await t.query<OrganizationOutput | null>("organization", { id })).toMatchObject({ takenDown: true, bio: null });
    expect((await t.query<{ items: unknown[] }>("organizationSearch", {})).items).toEqual([]);
    expect(await t.query("orgMembership", { orgId: id, address: ALICE.address })).toBeNull();
    expect(t.reactor.state<RenownOrganizationState>(id).takenDown).toBe(true);
    expect(await failure(resolve(t, first.id, "DISMISS"))).toMatchObject({ field: "reportId" });
    expect(await failure(resolve(t, first.id, "RELEASE_HANDLE"))).toMatchObject({ field: "reportId" });
    // Restored on the same report: no new report needs filing.
    expect(await resolve(t, first.id, "RESTORE")).toMatchObject({ status: "RESOLVED", resolution: "RESTORE", note: "checked" });
    expect(await failure(resolve(t, first.id, "RESTORE"))).toMatchObject({ field: "reportId" });
    expect((await t.query<OrganizationOutput | null>("organization", { id }))?.takenDown).toBe(false);
    expect(t.reactor.state<RenownOrganizationState>(id).takenDown).toBe(false);
    // The org audit says what happened, never the reason, the note or the reporter.
    const audit = (await t.store.auditPage(id, 5)).filter((e) => e.action.startsWith("moderation."));
    expect(audit.map((e) => [e.actor, e.action, e.details])).toEqual([
      [lower(EVE), "moderation.restored", { fields: ["takenDown"], takenDown: false }],
      [lower(EVE), "moderation.takenDown", { fields: ["takenDown"], takenDown: true }],
    ]);
    expect(JSON.stringify(await t.store.auditPage(id, 50))).not.toMatch(/checked|IMPERSONATION|fake|resolveOrgReport/);
  });

  it("dismisses without touching the organisation's audit, also for a report whose organisation is gone", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    await report(t, id);
    const [r] = await t.query<Report[]>("orgReports", {}, EVE);
    expect(await resolve(t, r.id, "DISMISS")).toMatchObject({ status: "RESOLVED", resolution: "DISMISS" });
    expect((await t.store.auditPage(id, 50)).map((e) => e.action)).toEqual(["createOrganization"]);
    await t.store.insertReport({
      id: "orphan", orgId: "gone", reporter: lower(BOB), reason: "SPAM", details: null, status: "OPEN",
      resolution: null, resolvedBy: null, resolvedAt: null, note: null, createdAt: T0,
    });
    expect((await t.query<Report[]>("orgReports", { status: "OPEN" }, EVE))[0]).toMatchObject({ id: "orphan", org: null });
    expect((await failure(resolve(t, "orphan", "TAKE_DOWN"))).code).toBe("NOT_FOUND");
    expect(await resolve(t, "orphan", "DISMISS")).toMatchObject({ status: "RESOLVED", resolution: "DISMISS" });
  });

  it("keeps the store unchanged when the document cannot be written", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    await report(t, id);
    const [r] = await t.query<Report[]>("orgReports", {}, EVE);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    t.reactor.execute.mockRejectedValueOnce(new Error("down"));
    expect((await failure(resolve(t, r.id, "TAKE_DOWN"))).code).toBe("SERVICE_UNAVAILABLE");
    t.reactor.execute.mockRejectedValueOnce(new Error("down"));
    expect((await failure(resolve(t, r.id, "RELEASE_HANDLE"))).code).toBe("SERVICE_UNAVAILABLE");
    errors.mockRestore();
    expect(await t.store.organization(id)).toMatchObject({ takenDown: false, handle: "acme" });
    expect(await t.store.reservedHandle("acme", t.clock.now)).toBeUndefined();
    expect(await t.store.report(r.id)).toMatchObject({ status: "OPEN" });
  });

  it("disables a taken-down organisation's OIDC clients and pauses its webhook deliveries until it is restored", async () => {
    const r = receiver();
    const t = harnessResolvers(h, { net: r.net, webhookKey: () => KEY });
    const sweep = () => createSweeper({ jobs: sweepJobs(t.rt), store: () => t.store, now: () => t.clock.now }).tick();
    const directory = createClientDirectory(new KyselyOidcStore(h.root.withSchema(OIDC_NS)), createOrgClientOwners(h.relationalDb));
    const { id } = await createOrg(t, ALICE, "acme");
    const { clientId } = await t.mutate<{ clientId: string }>(
      "registerOrgOidcClient",
      { orgId: id, name: "Acme wiki", redirectUris: ["https://wiki.acme.example/cb"] },
      ALICE,
    );
    const { webhook } = await t.mutate<{ webhook: { id: string } }>(
      "createOrgWebhook",
      { orgId: id, url: "https://hooks.example/renown", events: ["member.invited", "org.updated"] },
      ALICE,
    );
    await t.mutate("inviteOrgMember", { orgId: id, invitee: BOB.address, role: "MEMBER" }, ALICE);
    await report(t, id, CAROL);
    const [first] = await t.query<Report[]>("orgReports", {}, EVE);
    await resolve(t, first.id, "TAKE_DOWN");
    expect((await directory.getClient(clientId))?.status).toBe("DISABLED");
    await sweep();
    expect(r.requests).toHaveLength(0);
    // The queued invite waits; the takedown's own org.updated was never queued.
    expect((await t.store.deliveries(webhook.id, 10)).map((d) => [d.eventType, d.status, d.attempts])).toEqual([["member.invited", "PAUSED", 0]]);
    // One queued in a race with the takedown is paused when its turn comes, not sent.
    await t.store.insertDeliveries([
      { id: "late", webhookId: webhook.id, orgId: id, eventId: "e-late", eventType: "member.invited", body: JSON.stringify({ type: "member.invited" }), status: "PENDING", attempts: 0, responseStatus: null, lastError: null, createdAt: t.clock.now, nextAttemptAt: t.clock.now, deliveredAt: null },
    ]);
    t.tick(HOUR);
    await sweep();
    expect(r.requests).toHaveLength(0);
    expect((await t.store.deliveries(webhook.id, 10)).map((d) => d.status)).toEqual(["PAUSED", "PAUSED"]);

    await resolve(t, first.id, "RESTORE");
    expect((await directory.getClient(clientId))?.status).toBe("ACTIVE");
    t.tick(HOUR);
    await sweep();
    expect(r.requests.map((request) => (JSON.parse(request.body ?? "{}") as { type: string }).type).sort()).toEqual(["member.invited", "member.invited", "org.updated"]);
  });

  it("releases a disputed handle: the org is renamed and only the org verified for <handle>.<tld> may take it", async () => {
    const t = harnessResolvers(h);
    const squatter = await createOrg(t, ALICE, "acme");
    const owner = await createOrg(t, BOB, "acme-corp");
    const other = await createOrg(t, CAROL, "someone");
    await report(t, squatter.id, DAVE);
    const [r] = await t.query<Report[]>("orgReports", {}, EVE);
    await resolve(t, r.id, "RELEASE_HANDLE");
    const renamed = await t.query<OrganizationOutput | null>("organization", { id: squatter.id });
    // Document ids are base64url: characters a handle cannot hold become 0.
    expect(renamed?.handle).toBe(`org-${squatter.id.slice(0, 8).toLowerCase().replace(/[^a-z0-9]/g, "0")}`);
    expect(t.reactor.state<RenownOrganizationState>(squatter.id).handle).toBe(renamed?.handle);
    expect(await t.store.reservedHandle("acme", t.clock.now)).toMatchObject({ reason: "RELEASED", orgId: null });
    expect((await t.store.auditPage(squatter.id, 1))[0]).toMatchObject({ actor: lower(EVE), action: "moderation.handleReleased", details: { fields: ["handle"], from: "acme", to: renamed?.handle } });
    expect((await t.query<{ available: boolean }>("orgHandleAvailability", { handle: "acme" }, ALICE)).available).toBe(false);
    // The org that lost it cannot change back.
    expect(
      (await failure(t.mutate("proposeOrgChange", { orgId: squatter.id, kind: "CHANGE_HANDLE", payload: { handle: "acme" } }, ALICE))).code,
    ).toBe("HANDLE_RESERVED");
    expect((await failure(t.mutate("proposeOrgChange", { orgId: other.id, kind: "CHANGE_HANDLE", payload: { handle: "acme" } }, CAROL))).code).toBe("HANDLE_RESERVED");
    await t.store.db
      .insertInto("org_domains")
      .values({ id: "d0", org_id: other.id, domain: "acme.com", token: "t", status: "PENDING", verified_at: null, last_checked_at: null, failures: 0, created_at: T0 })
      .execute();
    expect((await failure(t.mutate("proposeOrgChange", { orgId: other.id, kind: "CHANGE_HANDLE", payload: { handle: "acme" } }, CAROL))).code).toBe("HANDLE_RESERVED");
    // A verified name that is not acme's own registrable domain does not count, also for the squatter.
    for (const [n, orgId, domain] of [[1, other.id, "acme.their-domain.com"], [2, other.id, "sub.acme.net"], [3, other.id, "acme-corp.com"], [4, squatter.id, "acme.squatter.org"]] as const) {
      await t.store.db
        .insertInto("org_domains")
        .values({ id: `x${n}`, org_id: orgId, domain, token: "t", status: "VERIFIED", verified_at: T0, last_checked_at: T0, failures: 0, created_at: T0 })
        .execute();
    }
    expect((await failure(t.mutate("proposeOrgChange", { orgId: other.id, kind: "CHANGE_HANDLE", payload: { handle: "acme" } }, CAROL))).code).toBe("HANDLE_RESERVED");
    expect((await failure(t.mutate("proposeOrgChange", { orgId: squatter.id, kind: "CHANGE_HANDLE", payload: { handle: "acme" } }, ALICE))).code).toBe("HANDLE_RESERVED");
    await t.store.db
      .insertInto("org_domains")
      .values({ id: "d1", org_id: owner.id, domain: "acme.co.uk", token: "t", status: "VERIFIED", verified_at: T0, last_checked_at: T0, failures: 0, created_at: T0 })
      .execute();
    const p = await t.mutate<ProposalOutput>("proposeOrgChange", { orgId: owner.id, kind: "CHANGE_HANDLE", payload: { handle: "acme" } }, BOB);
    t.tick(HOUR);
    expect((await t.mutate<ProposalOutput>("executeOrgProposal", { orgId: owner.id, proposalId: p.id }, BOB)).status).toBe("EXECUTED");
    expect((await t.query<OrganizationOutput | null>("organization", { handle: "acme" }))?.id).toBe(owner.id);
  });

  it("lets the window lapse: after 30 days anyone may take the released handle", async () => {
    const t = harnessResolvers(h);
    const squatter = await createOrg(t, ALICE, "acme");
    await report(t, squatter.id, DAVE);
    const [r] = await t.query<Report[]>("orgReports", {}, EVE);
    await resolve(t, r.id, "RELEASE_HANDLE");
    t.tick(30 * 24 * HOUR + 1);
    expect((await createOrg(t, CAROL, "acme")).handle).toBe("acme");
  });
});

describe("registrable domain names", () => {
  it.each([
    ["acme.com", true],
    ["acme.co.uk", true],
    ["acme.their-domain.com", false],
    ["sub.acme.com", false],
    ["acme-corp.com", false],
    ["acme.github.io", false],
    ["acme", false],
  ])("%s names acme: %s", (domain, names) => {
    expect(registrableDomainNames(domain, "acme")).toBe(names);
  });
});

describe("orgAuditExport", () => {
  it("exports the newest entries as a JSON array for admins only", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    await join(t, id, BOB, "MEMBER");
    const exported = JSON.parse(await t.query<string>("orgAuditExport", { orgId: id }, ALICE)) as { action: string; actor: string; details: unknown }[];
    expect(exported.map((e) => e.action)).toEqual(["respondToOrgInvite", "inviteOrgMember", "createOrganization"]);
    expect(exported[2]).toMatchObject({ actor: lower(ALICE), details: { handle: "acme", name: "ACME" } });
    expect((await failure(t.query("orgAuditExport", { orgId: id }, BOB))).code).toBe("FORBIDDEN");
    expect((await failure(t.query("orgAuditExport", { orgId: id }))).code).toBe("FORBIDDEN");
  });

  it(`caps the export at ${AUDIT_EXPORT_MAX} rows, drops secret-looking details and is throttled`, async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    const rows = Array.from({ length: AUDIT_EXPORT_MAX + 5 }, (_, i) => ({
      id: `a${String(i).padStart(6, "0")}`,
      org_id: id,
      at: new Date(T0.getTime() - (i + 1) * 1000),
      actor: "system",
      action: "test",
      details: JSON.stringify({
        n: i,
        secret: "s",
        apiKey: "k",
        api_key: "k",
        Authorization: "Bearer x",
        hmac: "h",
        jwt: "j",
        password: "p",
        cookie: "c",
        credential: "c",
        credentialId: "cred-1",
        nested: { tokenHash: "x", signature: "y", privateKey: "z", list: [{ authToken: "a", kept: 1 }], kept: true },
      }),
    }));
    for (let i = 0; i < rows.length; i += 1000) await t.store.db.insertInto("org_audit").values(rows.slice(i, i + 1000)).execute();
    const exported = JSON.parse(await t.query<string>("orgAuditExport", { orgId: id }, ALICE)) as { action: string; details: Record<string, unknown> }[];
    expect(exported).toHaveLength(AUDIT_EXPORT_MAX);
    expect(exported[0].action).toBe("createOrganization");
    expect(exported[1].details).toEqual({ n: 0, credentialId: "cred-1", nested: { list: [{ kept: 1 }], kept: true } });
    for (let i = 1; i < AUDIT_EXPORTS_PER_HOUR; i++) await t.query("orgAuditExport", { orgId: id }, ALICE);
    expect((await failure(t.query("orgAuditExport", { orgId: id }, ALICE))).code).toBe("RATE_LIMITED");
    t.tick(HOUR + 1);
    expect(typeof (await t.query("orgAuditExport", { orgId: id }, ALICE))).toBe("string");
  }, 60_000);
});
