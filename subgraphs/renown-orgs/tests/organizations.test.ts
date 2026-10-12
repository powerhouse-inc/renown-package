import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createRateLimiter } from "../../renown-auth/core/rate-limit.js";
import type { RenownOrganizationState } from "../../../document-models/renown-organization/index.js";
import type { OrganizationOutput } from "../output.js";
import {
  ALICE,
  BOB,
  CAROL,
  createOrg,
  failure,
  fakeReactor,
  harnessResolvers,
  insertUser,
  lower,
  openHarness,
  pngMedia,
  resetHarness,
  T0,
  type Harness,
} from "./harness.js";
import { memberRecord, org as orgRecord } from "./store-contract.js";

vi.mock("../../renown-auth/core/smart-wallet.js", () => ({
  verifyMessageOnChain: () => Promise.resolve(false),
  verifyTypedDataOnChain: () => Promise.resolve(false),
}));

const AVATAR = `attachment://v1:${"b".repeat(64)}`;
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

describe("createOrganization", () => {
  it("creates the org, its document and the creator as the only active owner", async () => {
    const t = harnessResolvers(h);
    const org = await createOrg(t, ALICE, "acme", {
      name: "Acme Inc.",
      bio: " Tools ",
      links: [{ id: "l1", label: "Docs", url: "https://docs.acme.example" }],
      listed: true,
    });
    expect(org).toMatchObject({
      handle: "acme",
      name: "Acme Inc.",
      bio: "Tools",
      did: `did:web:renown.test:org:${org.id}`,
      listed: true,
      membersPublic: false,
      createdBy: lower(ALICE),
      ownerCount: 1,
      memberCount: 1,
      securityWarnings: ["SINGLE_OWNER"],
      viewerMembership: { role: "OWNER", status: "ACTIVE", appScope: { all: true, appDids: [] }, teams: [] },
    });
    const state = t.reactor.state<RenownOrganizationState>(org.id);
    expect(state).toMatchObject({ handle: "acme", name: "Acme Inc.", bio: "Tools", listed: true, createdBy: lower(ALICE) });
    expect(state.members).toMatchObject([{ address: lower(ALICE), role: "OWNER", status: "ACTIVE" }]);
    expect((await t.store.auditPage(org.id, 10)).map((e) => [e.action, e.actor])).toEqual([["createOrganization", lower(ALICE)]]);
  });

  it("accepts a signed createOrganization and rejects one signed over other arguments", async () => {
    const t = harnessResolvers(h);
    const created = await t.signed<OrganizationOutput>("createOrganization", { handle: "acme", name: "Acme" }, BOB);
    expect(created.createdBy).toBe(lower(BOB));
    const auth = await t.auth("createOrganization", { handle: "beta", name: "Beta" }, BOB);
    expect((await failure(t.mutate("createOrganization", { handle: "beta", name: "Beta", bio: "x", auth }))).code).toBe("FORBIDDEN");
    // A null the client signed is an argument; omitting it changes the hash.
    const withNull = await t.auth("createOrganization", { handle: "gamma", name: "Gamma", bio: null }, BOB);
    expect((await failure(t.mutate("createOrganization", { handle: "gamma", name: "Gamma", auth: withNull }))).code).toBe("FORBIDDEN");
    expect((await t.mutate<OrganizationOutput>("createOrganization", { handle: "gamma", name: "Gamma", bio: null, auth: withNull })).handle).toBe("gamma");
  });

  it("keeps one namespace with users and refuses invalid, reserved and taken handles", async () => {
    const t = harnessResolvers(h);
    await createOrg(t, ALICE, "acme");
    await insertUser(h, { address: lower(CAROL), handle: "frank", documentId: "u1" });
    await t.store.reserveHandle({ handle: "oldco", until: new Date(T0.getTime() + 60_000), reason: "ARCHIVED", orgId: "o-old" });
    const attempt = (handle: string) => failure(createOrg(t, BOB, handle));
    expect(await attempt("Acme Inc")).toMatchObject({ code: "BAD_USER_INPUT", field: "handle" });
    expect(await attempt("admin")).toMatchObject({ code: "HANDLE_RESERVED", field: "handle" });
    expect(await attempt("orgs")).toMatchObject({ code: "HANDLE_RESERVED" });
    expect(await attempt(" ACME ")).toMatchObject({ code: "HANDLE_TAKEN", field: "handle" });
    expect(await attempt("Frank")).toMatchObject({ code: "HANDLE_TAKEN" });
    expect(await attempt("oldco")).toMatchObject({ code: "HANDLE_RESERVED" });
    t.tick(60_000);
    expect((await createOrg(t, BOB, "oldco")).handle).toBe("oldco");
  });

  it("validates the profile, naming the field", async () => {
    const t = harnessResolvers(h);
    const link = (id: string) => ({ id, label: "x", url: "https://x.example" });
    const cases: [Record<string, unknown>, string][] = [
      [{ name: "  " }, "name"],
      [{ bio: "b".repeat(281) }, "bio"],
      [{ website: "ftp://acme.example" }, "website"],
      [{ links: Array.from({ length: 9 }, (_, i) => link(`l${i}`)) }, "links"],
      [{ links: [link("l1"), link("l1")] }, "links"],
      [{ links: [{ id: "l1", label: "x", url: "javascript:alert(1)" }] }, "links"],
    ];
    for (const [extra, field] of cases) {
      expect(await failure(createOrg(t, ALICE, "acme", extra))).toMatchObject({ code: "BAD_USER_INPUT", field });
    }
    expect(await t.store.organizationByHandle("acme")).toBeUndefined();
  });

  it("limits organizations per creator and memberships per wallet", async () => {
    const t = harnessResolvers(h);
    for (let i = 0; i < 20; i++) await t.store.insertOrganization(orgRecord(`o${i}`, `made-${i}`, { createdBy: lower(ALICE) }));
    expect((await failure(createOrg(t, ALICE, "acme"))).code).toBe("LIMIT_REACHED");
    for (let i = 0; i < 50; i++) await t.store.insertMember(memberRecord(`m${i}`, `x${i}`, lower(BOB)));
    expect((await failure(createOrg(t, BOB, "beta"))).code).toBe("LIMIT_REACHED");
  });

  it("rate limits writes per address", async () => {
    const t = harnessResolvers(h, { writeLimiter: { take: () => false } });
    expect((await failure(createOrg(t, ALICE, "acme"))).code).toBe("RATE_LIMITED");
  });
});

describe("updateOrganization and setOrgListed", () => {
  it("patches the profile for admins: absent keeps, empty clears, links replace", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme", { bio: "Tools", website: "https://acme.example" });
    const updated = await t.mutate<OrganizationOutput>(
      "updateOrganization",
      { orgId: id, name: "Acme Labs", bio: "", links: [{ id: "l1", label: "Blog", url: "https://blog.acme.example" }], membersPublic: true },
      ALICE,
    );
    expect(updated).toMatchObject({ name: "Acme Labs", bio: null, website: "https://acme.example", membersPublic: true, links: [{ id: "l1" }] });
    expect(t.reactor.state<RenownOrganizationState>(id)).toMatchObject({ name: "Acme Labs", bio: null, website: "https://acme.example", membersPublic: true });
    expect((await t.store.auditPage(id, 1))[0]).toMatchObject({ action: "updateOrganization", details: { fields: ["name", "bio", "links", "membersPublic"] } });
  });

  it("checks the avatar like a profile avatar", async () => {
    const offline = harnessResolvers(h);
    const { id } = await createOrg(offline, ALICE, "acme");
    expect((await failure(offline.mutate("updateOrganization", { orgId: id, avatar: AVATAR }, ALICE))).code).toBe("SERVICE_UNAVAILABLE");
    const missing = harnessResolvers(h, { media: () => pngMedia(false) });
    expect(await failure(missing.mutate("updateOrganization", { orgId: id, avatar: AVATAR }, ALICE))).toMatchObject({ code: "BAD_USER_INPUT", field: "avatar" });
    const stored = harnessResolvers(h, { media: () => pngMedia() });
    stored.reactor.docs.set(id, offline.reactor.docs.get(id)!);
    expect((await stored.mutate<OrganizationOutput>("updateOrganization", { orgId: id, avatar: AVATAR }, ALICE)).avatar).toBe(AVATAR);
  });

  it("writes the store first: a failed store write leaves the document alone, a failed document write undoes the store", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme", { bio: "Tools" });
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const storeWrite = vi.spyOn(t.store, "updateOrganization").mockRejectedValue(new Error("db down"));
    await expect(t.mutate("updateOrganization", { orgId: id, name: "Acme Labs", membersPublic: true }, ALICE)).rejects.toThrow();
    await expect(t.mutate("setOrgListed", { orgId: id, listed: true }, ALICE)).rejects.toThrow();
    storeWrite.mockRestore();
    expect(t.reactor.state<RenownOrganizationState>(id)).toMatchObject({ name: "ACME", membersPublic: false, listed: false });
    t.reactor.execute.mockRejectedValueOnce(new Error("reactor down"));
    expect((await failure(t.mutate("updateOrganization", { orgId: id, name: "Acme Labs", bio: "" }, ALICE))).code).toBe("SERVICE_UNAVAILABLE");
    t.reactor.execute.mockRejectedValueOnce(new Error("reactor down"));
    expect((await failure(t.mutate("setOrgListed", { orgId: id, listed: true }, ALICE))).code).toBe("SERVICE_UNAVAILABLE");
    errors.mockRestore();
    expect(await t.store.organization(id)).toMatchObject({ name: "ACME", bio: "Tools", listed: false });
  });

  it("refuses non-admins, unknown organizations and archived ones", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    expect((await failure(t.mutate("updateOrganization", { orgId: id, name: "Mine" }, BOB))).code).toBe("FORBIDDEN");
    expect((await failure(t.mutate("updateOrganization", { orgId: "nope", name: "X" }, ALICE))).code).toBe("NOT_FOUND");
    expect((await failure(t.mutate("setOrgListed", { orgId: id, listed: true }))).code).toBe("FORBIDDEN");
    await t.store.updateOrganization(id, { archived: true }, T0);
    expect((await failure(t.mutate("setOrgListed", { orgId: id, listed: true }, ALICE))).code).toBe("FORBIDDEN");
  });
});

describe("organization, organizationSearch, orgHandleAvailability", () => {
  it("finds an organization by id or handle; teams and the viewer's membership only for members", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    expect((await t.query<OrganizationOutput | null>("organization", { handle: "ACME" }))?.id).toBe(id);
    const anonymous = await t.query<OrganizationOutput>("organization", { id });
    expect(anonymous).toMatchObject({ viewerMembership: null, teams: [] });
    expect((await t.query<OrganizationOutput | null>("organization", { id }, ALICE))?.viewerMembership?.role).toBe("OWNER");
    expect(await t.query("organization", { id: "nope" })).toBeNull();
    expect((await failure(t.query("organization", {}))).field).toBe("id");
    expect((await failure(t.query("organization", { id, handle: "acme" }))).field).toBe("id");
  });

  it("empties a taken-down organization's profile", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme", { bio: "Tools" });
    await t.store.updateOrganization(id, { takenDown: true }, T0);
    expect(await t.query("organization", { id }, ALICE)).toMatchObject({
      handle: "acme",
      takenDown: true,
      bio: null,
      links: [],
      apps: [],
      memberCount: 0,
      viewerMembership: null,
    });
  });

  it("warns when another organization with a verified domain has the same name", async () => {
    const t = harnessResolvers(h);
    const real = await createOrg(t, ALICE, "acme", { name: "Acme" });
    const copy = await createOrg(t, BOB, "acme-official", { name: "ACME" });
    await t.store.db
      .insertInto("org_domains")
      .values({ id: "d1", org_id: real.id, domain: "acme.example", token: "t", status: "VERIFIED", verified_at: T0, last_checked_at: T0, failures: 0, created_at: T0 })
      .execute();
    expect(await t.query("organization", { id: copy.id })).toMatchObject({
      verifiedDomains: [],
      notAffiliatedWith: { id: real.id, handle: "acme", verifiedDomains: ["acme.example"] },
    });
    expect(await t.query("organization", { id: real.id })).toMatchObject({ verifiedDomains: ["acme.example"], notAffiliatedWith: null });
  });

  it("lists listed, live organizations by prefix and pages with a cursor", async () => {
    const t = harnessResolvers(h);
    const acme = await createOrg(t, ALICE, "acme", { name: "Acme", listed: true });
    await createOrg(t, ALICE, "acorn", { name: "Oak", listed: true });
    await createOrg(t, ALICE, "acid", { name: "Acid" });
    await t.mutate("setOrgListed", { orgId: acme.id, listed: true }, ALICE);
    const first = await t.query<{ items: OrganizationOutput[]; next: string | null }>("organizationSearch", { query: "AC", limit: 1 });
    expect(first.items.map((o) => o.handle)).toEqual(["acme"]);
    const second = await t.query<{ items: OrganizationOutput[]; next: string | null }>("organizationSearch", { query: "ac", limit: 1, after: first.next });
    expect([second.items.map((o) => o.handle), second.next]).toEqual([["acorn"], null]);
    const all = await t.query<{ items: OrganizationOutput[] }>("organizationSearch", { query: "  " });
    expect(all.items.map((o) => o.handle)).toEqual(["acme", "acorn"]);
  });

  it("validates search arguments", async () => {
    const t = harnessResolvers(h);
    expect((await failure(t.query("organizationSearch", { query: "a" }))).field).toBe("query");
    expect((await failure(t.query("organizationSearch", { query: "x".repeat(41) }))).field).toBe("query");
    expect((await failure(t.query("organizationSearch", { limit: 51 }))).field).toBe("limit");
    expect((await failure(t.query("organizationSearch", { after: "garbage" }))).field).toBe("after");
  });

  it("answers handle availability across users, organizations and reserved handles", async () => {
    const t = harnessResolvers(h);
    await createOrg(t, ALICE, "acme");
    await insertUser(h, { address: lower(BOB), handle: "bob", documentId: "u1" });
    expect(await t.query("orgHandleAvailability", { handle: " Acme " })).toEqual({ handle: "acme", available: false, reason: "TAKEN" });
    expect(await t.query("orgHandleAvailability", { handle: "bob" })).toEqual({ handle: "bob", available: false, reason: "TAKEN" });
    expect(await t.query("orgHandleAvailability", { handle: "invite" })).toEqual({ handle: "invite", available: false, reason: "RESERVED" });
    expect(await t.query("orgHandleAvailability", { handle: "x" })).toEqual({ handle: "x", available: false, reason: "INVALID" });
    expect(await t.query("orgHandleAvailability", { handle: "fresh" })).toEqual({ handle: "fresh", available: true, reason: null });
  });
});

describe("orgAuditLog", () => {
  it("pages the audit log for admins only", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    for (const listed of [true, false, true]) {
      t.tick(1000);
      await t.mutate("setOrgListed", { orgId: id, listed }, ALICE);
    }
    type Page = { items: { action: string; details: string }[]; next: string | null };
    const first = await t.query<Page>("orgAuditLog", { orgId: id, limit: 2 }, ALICE);
    expect(first.items.map((e) => e.action)).toEqual(["setOrgListed", "setOrgListed"]);
    expect(JSON.parse(first.items[0].details)).toEqual({ listed: true });
    const rest = await t.query<Page>("orgAuditLog", { orgId: id, limit: 2, after: first.next }, ALICE);
    expect([rest.items.map((e) => e.action), rest.next]).toEqual([["setOrgListed", "createOrganization"], null]);
    expect((await failure(t.query("orgAuditLog", { orgId: id }, BOB))).code).toBe("FORBIDDEN");
    expect((await failure(t.query("orgAuditLog", { orgId: id }))).code).toBe("FORBIDDEN");
    expect((await failure(t.query("orgAuditLog", { orgId: id, limit: 0 }, ALICE))).field).toBe("limit");
  });
});

describe("signed writes", () => {
  it("refuses a replayed signature; bearer writes record nothing", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    expect(await h.root.withSchema("renown-orgs").selectFrom("org_used_signatures").selectAll().execute()).toEqual([]);
    const args = { orgId: id, listed: true };
    const auth = await t.auth("setOrgListed", args, ALICE);
    expect((await t.mutate<OrganizationOutput>("setOrgListed", { ...args, auth })).listed).toBe(true);
    expect(await failure(t.mutate("setOrgListed", { ...args, auth }))).toMatchObject({ code: "FORBIDDEN", message: "signature already used" });
    // Same signature, different case: still the same signature.
    const upper = { ...auth, signature: `0x${auth.signature.slice(2).toUpperCase()}` };
    expect(await failure(t.mutate("setOrgListed", { ...args, auth: upper }))).toMatchObject({ code: "FORBIDDEN", message: "signature already used" });
    // A malleated encoding (v 27/28 -> 0/1) authorises the same message: still used.
    const v = parseInt(auth.signature.slice(-2), 16);
    const malleated = { ...auth, signature: `${auth.signature.slice(0, -2)}${(v - 27).toString(16).padStart(2, "0")}` };
    expect(malleated.signature).not.toBe(auth.signature);
    expect(await failure(t.mutate("setOrgListed", { ...args, auth: malleated }))).toMatchObject({ code: "FORBIDDEN", message: "signature already used" });
    const rows = await h.root.withSchema("renown-orgs").selectFrom("org_used_signatures").selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(new Date(rows[0].expires_at as string).getTime()).toBe(T0.getTime() + 600_000);
    // Bearer writes are unaffected.
    await t.mutate("setOrgListed", args, ALICE);
    await t.mutate("setOrgListed", args, ALICE);
    expect((await h.root.withSchema("renown-orgs").selectFrom("org_used_signatures").selectAll().execute()).length).toBe(1);
  });

  it("never persists role-derived app scope (owners act for every app anyway)", async () => {
    const t = harnessResolvers(h);
    const org = await createOrg(t, ALICE, "acme");
    expect(org.viewerMembership?.appScope).toEqual({ all: true, appDids: [] });
    expect((await t.store.openMember(org.id, lower(ALICE)))?.appScopeAll).toBe(false);
    expect(t.reactor.state<RenownOrganizationState>(org.id).members[0].appScope.all).toBe(false);
  });
});

describe("createOrganization failures", () => {
  it("leaves no organization, owner or handle behind when the document cannot be written", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const reactor = fakeReactor();
    reactor.execute.mockImplementation(() => Promise.reject(new Error("reactor down")));
    const t = harnessResolvers(h, { reactorClient: reactor as never });
    expect((await failure(createOrg(t, ALICE, "acme"))).code).toBe("SERVICE_UNAVAILABLE");
    expect(await t.store.organizationByHandle("acme")).toBeUndefined();
    expect(await t.store.membershipsOf(lower(ALICE), ["ACTIVE", "INVITED"])).toEqual([]);
    expect(await t.store.countOrganizationsCreatedBy(lower(ALICE))).toBe(0);
    const failingCreate = fakeReactor();
    failingCreate.createEmpty.mockImplementation(() => Promise.reject(new Error("reactor down")));
    expect((await failure(createOrg(harnessResolvers(h, { reactorClient: failingCreate as never }), ALICE, "acme"))).code).toBe("SERVICE_UNAVAILABLE");
    // The handle is still free.
    expect((await createOrg(harnessResolvers(h), ALICE, "acme")).handle).toBe("acme");
    vi.restoreAllMocks();
  });

  it("enforces the per-creator limit across concurrent creates", async () => {
    const t = harnessResolvers(h);
    for (let i = 0; i < 19; i++) await t.store.insertOrganization(orgRecord(`o${i}`, `made-${i}`, { createdBy: lower(ALICE) }));
    const results = await Promise.allSettled([createOrg(t, ALICE, "acme"), createOrg(t, ALICE, "beta")]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(await t.store.countOrganizationsCreatedBy(lower(ALICE))).toBe(20);
  });
});

describe("authorisation order and read limits", () => {
  it("checks the caller's role before probing the avatar", async () => {
    const media = pngMedia(false);
    const inspect = vi.spyOn(media, "inspect");
    const t = harnessResolvers(h, { media: () => media });
    const { id } = await createOrg(t, ALICE, "acme");
    expect((await failure(t.mutate("updateOrganization", { orgId: id, avatar: AVATAR }, BOB))).code).toBe("FORBIDDEN");
    expect(inspect).not.toHaveBeenCalled();
  });

  it("rate limits handle availability and search per caller or client IP", async () => {
    const limited = harnessResolvers(h, { readLimiter: { take: () => false } });
    expect((await failure(limited.query("orgHandleAvailability", { handle: "acme" }))).code).toBe("RATE_LIMITED");
    expect((await failure(limited.query("organizationSearch", {}))).code).toBe("RATE_LIMITED");
    const t = harnessResolvers(h, { readLimiter: createRateLimiter(2, 60_000) });
    const ip = (address: string) => ({ headers: { "x-forwarded-for": `${address}, 10.0.0.1` } });
    const call = (ctx: unknown) => t.resolvers.Query.orgHandleAvailability(null, { handle: "fresh" }, ctx);
    await call(ip("1.1.1.1"));
    await call(ip("1.1.1.1"));
    expect((await failure(call(ip("1.1.1.1")))).code).toBe("RATE_LIMITED");
    await call(ip("2.2.2.2"));
    await call({ user: { address: ALICE.address } });
    await call({ user: { address: ALICE.address } });
    expect((await failure(call({ user: { address: ALICE.address } }))).code).toBe("RATE_LIMITED");
    await call({ user: { address: BOB.address } });
  });
});

describe("organizationSearch visibility", () => {
  it("excludes archived and taken-down organizations even when listed", async () => {
    const t = harnessResolvers(h);
    const archived = await createOrg(t, ALICE, "acme", { listed: true });
    const down = await createOrg(t, ALICE, "acorn", { listed: true });
    await createOrg(t, ALICE, "acid", { listed: true });
    await t.store.updateOrganization(archived.id, { archived: true }, T0);
    await t.store.updateOrganization(down.id, { takenDown: true }, T0);
    const page = await t.query<{ items: OrganizationOutput[] }>("organizationSearch", { query: "ac" });
    expect(page.items.map((o) => o.handle)).toEqual(["acid"]);
    expect((await t.query<{ items: OrganizationOutput[] }>("organizationSearch", {})).items.map((o) => o.handle)).toEqual(["acid"]);
  });
});
