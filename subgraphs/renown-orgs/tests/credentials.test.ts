import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RenownOrganizationState } from "../../../document-models/renown-organization/index.js";
import { sql } from "kysely";
import { migrate } from "../store/migrations.js";
import { ORGS_NAMESPACE } from "../store/types.js";
import { ALICE, BOB, CAROL, DAVE, createOrg, failure, harnessResolvers, insertCredential, join, lower, openHarness, resetHarness, T0, type Harness, type TestResolvers } from "./harness.js";

vi.mock("../../renown-auth/core/smart-wallet.js", () => ({
  verifyMessageOnChain: () => Promise.resolve(false),
  verifyTypedDataOnChain: () => Promise.resolve(false),
}));

const APP = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";
const PERSON_APP = "did:key:zDnaerDaTF5BXEavCrfRZEk316dpbLsfPDZ3WJ5hRTPFU2169";
type Status = { credentialId: string; appDid: string | null; orgId: string | null; counts: boolean; reason: string | null };
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

/** acme owns APP; BOB publishes it (scope), CAROL is a plain member. */
async function setup(t: TestResolvers = harnessResolvers(h)) {
  const { id } = await createOrg(t, ALICE, "acme");
  await join(t, id, BOB, "PUBLISHER");
  await join(t, id, CAROL, "MEMBER");
  await t.mutate("setOrgMemberAppScope", { orgId: id, address: BOB.address, appScope: { all: false, appDids: [APP] } }, ALICE);
  await t.store.db.insertInto("org_apps").values({ app_did: APP, org_id: id, frozen: false, added_at: T0 }).execute();
  await insertCredential(h, { credentialId: "c-bob", issuer: lower(BOB), appDid: APP });
  await insertCredential(h, { credentialId: "c-carol", issuer: lower(CAROL), appDid: APP });
  await insertCredential(h, { credentialId: "c-dave", issuer: lower(DAVE), appDid: APP });
  await insertCredential(h, { credentialId: "c-person", issuer: lower(DAVE), appDid: PERSON_APP });
  return { t, id };
}

const status = (t: TestResolvers, credentialId: string) => t.query<Status | null>("orgCredentialStatus", { credentialId });

describe("credential status under organisation rules", () => {
  it("explains whether each delegation counts", async () => {
    const { t, id } = await setup();
    expect(await status(t, "c-bob")).toEqual({ credentialId: "c-bob", appDid: APP, orgId: id, counts: true, reason: null });
    expect(await status(t, "c-carol")).toMatchObject({ counts: false, reason: "ISSUER_NOT_PUBLISHER" });
    expect(await status(t, "c-dave")).toMatchObject({ counts: false, reason: "ISSUER_NOT_MEMBER" });
    expect(await status(t, "c-person")).toEqual({ credentialId: "c-person", appDid: PERSON_APP, orgId: null, counts: true, reason: null });
    expect(await status(t, "nope")).toBeNull();
    await t.mutate("suspendOrgCredentials", { orgId: id, credentialIds: ["c-bob"] }, ALICE);
    expect(await status(t, "c-bob")).toMatchObject({ counts: false, reason: "SUSPENDED" });
    await t.store.db.updateTable("org_apps").set({ frozen: true }).execute();
    expect(await status(t, "c-bob")).toMatchObject({ counts: false, reason: "APP_FROZEN" });
  });

  it("counts team scope, and never an issuer of an archived organisation", async () => {
    const { t, id } = await setup();
    await t.mutate("setOrgMemberRole", { orgId: id, address: CAROL.address, role: "PUBLISHER" }, ALICE);
    expect(await status(t, "c-carol")).toMatchObject({ counts: false, reason: "ISSUER_NOT_PUBLISHER" });
    await t.mutate("createOrgTeam", { orgId: id, slug: "core", name: "Core", appDids: [APP] }, ALICE);
    const team = (await t.store.teams(id))[0];
    await t.mutate("setOrgTeamMembers", { orgId: id, teamId: team.id, addresses: [CAROL.address] }, ALICE);
    expect(await status(t, "c-carol")).toMatchObject({ counts: true, reason: null });
    await t.store.db.updateTable("organizations").set({ archived: true }).execute();
    expect(await status(t, "c-carol")).toMatchObject({ counts: false, reason: "ISSUER_NOT_MEMBER" });
  });

  it("is unavailable, not a verdict, when organisation data cannot be read", async () => {
    const { t } = await setup();
    const broken = harnessResolvers(h, {
      relationalDb: {
        queryNamespace: (ns: string) => {
          if (ns === "renown-orgs") throw new Error("connection refused");
          return h.relationalDb.queryNamespace(ns);
        },
        createNamespace: (ns: string) => h.relationalDb.createNamespace(ns),
      } as never,
    });
    expect((await failure(status(broken, "c-bob"))).code).toBe("SERVICE_UNAVAILABLE");
    expect(await status(t, "c-bob")).toMatchObject({ counts: true });
  });

  it("suspends a leaving or removed member's delegations, and the suspension survives re-joining", async () => {
    const { t, id } = await setup();
    await t.mutate("removeOrgMember", { orgId: id, address: BOB.address }, ALICE);
    expect(await status(t, "c-bob")).toMatchObject({ counts: false, reason: "SUSPENDED" });
    expect(t.reactor.state<RenownOrganizationState>(id).suspendedCredentialIds).toEqual(["c-bob"]);
    await join(t, id, BOB, "PUBLISHER");
    await t.mutate("setOrgMemberAppScope", { orgId: id, address: BOB.address, appScope: { all: true, appDids: [] } }, ALICE);
    expect(await status(t, "c-bob")).toMatchObject({ counts: false, reason: "SUSPENDED" });
    expect(await t.mutate("unsuspendOrgCredential", { orgId: id, credentialId: "c-bob" }, ALICE)).toBe(true);
    expect(await status(t, "c-bob")).toMatchObject({ counts: true, reason: null });
    expect(t.reactor.state<RenownOrganizationState>(id).suspendedCredentialIds).toEqual([]);
    expect((await failure(t.mutate("unsuspendOrgCredential", { orgId: id, credentialId: "c-bob" }, ALICE))).code).toBe("NOT_FOUND");
  });

  it("suspends a leaver's live delegations only, recording why", async () => {
    const { t, id } = await setup();
    await insertCredential(h, { credentialId: "c-carol-old", issuer: lower(CAROL), appDid: APP, revoked: true });
    await insertCredential(h, { credentialId: "c-carol-expired", issuer: lower(CAROL), appDid: APP, expiresAt: new Date("2026-01-01T00:00:00Z") });
    await t.mutate("leaveOrganization", { orgId: id }, CAROL);
    expect(await t.store.suspendedCredentialIds(id)).toEqual(["c-carol"]);
    const rows = await t.store.db.selectFrom("org_credential_suspensions").select(["reason", "member_address"]).execute();
    expect(rows).toEqual([{ reason: "MEMBER_LEFT", member_address: lower(CAROL) }]);
    const audit = await t.store.auditPage(id, 10);
    expect(audit.find((entry) => entry.action === "system.suspendOnExit")).toMatchObject({
      actor: lower(CAROL),
      details: { credentialIds: ["c-carol"], reason: "MEMBER_LEFT", memberAddress: lower(CAROL) },
    });
  });

  it("suspends by credential ids or by member, for admins, only for the organisation's apps", async () => {
    const { t, id } = await setup();
    expect(await failure(t.mutate("suspendOrgCredentials", { orgId: id }, ALICE))).toMatchObject({ field: "credentialIds" });
    expect(await failure(t.mutate("suspendOrgCredentials", { orgId: id, credentialIds: ["c-person"] }, ALICE))).toMatchObject({ field: "credentialIds" });
    expect((await failure(t.mutate("suspendOrgCredentials", { orgId: id, credentialIds: ["c-bob"] }, BOB))).code).toBe("FORBIDDEN");
    expect((await failure(t.mutate("unsuspendOrgCredential", { orgId: id, credentialId: "c-bob" }, BOB))).code).toBe("FORBIDDEN");
    expect((await failure(t.query("orgCredentials", { orgId: id }, BOB))).code).toBe("FORBIDDEN");
    expect(await t.mutate("suspendOrgCredentials", { orgId: id, memberAddress: CAROL.address }, ALICE)).toEqual(["c-carol"]);
    const rows = await t.query<{ credentialId: string; issuerRole: string | null; issuerStatus: string | null; status: Status }[]>("orgCredentials", { orgId: id }, ALICE);
    expect(rows.map((r) => [r.credentialId, r.issuerRole, r.issuerStatus, r.status.reason]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))).toEqual([
      ["c-bob", "PUBLISHER", "ACTIVE", null],
      ["c-carol", "MEMBER", "ACTIVE", "SUSPENDED"],
      ["c-dave", null, null, "ISSUER_NOT_MEMBER"],
    ]);
  });

  it("keeps an exit suspension when the document cannot record it", async () => {
    const t = harnessResolvers(h);
    const { id } = await setup(t);
    const real = t.reactor.execute.getMockImplementation();
    if (!real) throw new Error("no reactor implementation");
    // removeOrgMember's own write succeeds; the suspension mirror fails.
    t.reactor.execute.mockImplementationOnce(real).mockImplementationOnce(() => Promise.reject(new Error("reactor down")));
    await t.mutate("removeOrgMember", { orgId: id, address: BOB.address }, ALICE);
    expect(await status(t, "c-bob")).toMatchObject({ counts: false, reason: "SUSPENDED" });
    expect(t.reactor.state<RenownOrganizationState>(id).suspendedCredentialIds).toEqual([]);
    await join(t, id, BOB, "PUBLISHER");
    await t.mutate("setOrgMemberAppScope", { orgId: id, address: BOB.address, appScope: { all: true, appDids: [] } }, ALICE);
    expect(await status(t, "c-bob")).toMatchObject({ counts: false, reason: "SUSPENDED" });
    // The document never listed it: unsuspending lifts the store row only.
    expect(await t.mutate("unsuspendOrgCredential", { orgId: id, credentialId: "c-bob" }, ALICE)).toBe(true);
    expect(await status(t, "c-bob")).toMatchObject({ counts: true });
  });

  it("suspends the whole member when an exit cannot list their delegations, until an admin unsuspends one", async () => {
    let credentialsDown = false;
    const t = harnessResolvers(h, {
      relationalDb: {
        queryNamespace: (ns: string) => {
          if (credentialsDown && ns !== ORGS_NAMESPACE) throw new Error("read model down");
          return h.relationalDb.queryNamespace(ns);
        },
        createNamespace: (ns: string) => h.relationalDb.createNamespace(ns),
      } as never,
    });
    const { id } = await setup(t);
    await insertCredential(h, { credentialId: "c-bob-2", issuer: lower(BOB), appDid: APP });
    credentialsDown = true;
    await t.mutate("removeOrgMember", { orgId: id, address: BOB.address }, ALICE);
    credentialsDown = false;
    expect(await t.store.suspendedCredentialIds(id)).toEqual([`member:${lower(BOB)}`]);
    await join(t, id, BOB, "PUBLISHER");
    await t.mutate("setOrgMemberAppScope", { orgId: id, address: BOB.address, appScope: { all: true, appDids: [] } }, ALICE);
    expect(await status(t, "c-bob")).toMatchObject({ counts: false, reason: "SUSPENDED" });
    expect(await status(t, "c-bob-2")).toMatchObject({ counts: false, reason: "SUSPENDED" });
    // Lifting one credential turns the member suspension into per-credential rows.
    expect(await t.mutate("unsuspendOrgCredential", { orgId: id, credentialId: "c-bob" }, ALICE)).toBe(true);
    expect(await status(t, "c-bob")).toMatchObject({ counts: true, reason: null });
    expect(await status(t, "c-bob-2")).toMatchObject({ counts: false, reason: "SUSPENDED" });
    expect(await t.store.suspendedCredentialIds(id)).toEqual(["c-bob-2"]);
    expect(t.reactor.state<RenownOrganizationState>(id).suspendedCredentialIds).toEqual(["c-bob-2"]);
  });

  it("fails closed once the app is an org app, even when a later table is missing", async () => {
    const { t } = await setup();
    await sql`drop table ${sql.id(ORGS_NAMESPACE, "org_credential_suspensions")}`.execute(h.root);
    try {
      expect((await failure(status(t, "c-bob"))).code).toBe("SERVICE_UNAVAILABLE");
      expect(await status(t, "c-person")).toMatchObject({ counts: true });
    } finally {
      await migrate(h.root.withSchema(ORGS_NAMESPACE));
    }
  });

  it("caps credentialIds and returns only newly suspended ids", async () => {
    const { t, id } = await setup();
    const many = Array.from({ length: 101 }, (_, i) => `c-${i}`);
    expect(await failure(t.mutate("suspendOrgCredentials", { orgId: id, credentialIds: many }, ALICE))).toMatchObject({ code: "BAD_USER_INPUT", field: "credentialIds" });
    expect(await t.mutate("suspendOrgCredentials", { orgId: id, credentialIds: ["c-bob"] }, ALICE)).toEqual(["c-bob"]);
    expect(await t.mutate("suspendOrgCredentials", { orgId: id, credentialIds: ["c-bob", "c-carol"] }, ALICE)).toEqual(["c-carol"]);
  });

  it("throttles anonymous status reads", async () => {
    const { t } = await setup();
    for (let i = 0; i < 60; i++) await status(t, "nope");
    expect((await failure(status(t, "nope"))).code).toBe("RATE_LIMITED");
  });

  it("rolls the store back when the document cannot record a suspension", async () => {
    const t = harnessResolvers(h);
    const { id } = await setup(t);
    t.reactor.execute.mockImplementationOnce(() => Promise.reject(new Error("reactor down")));
    expect((await failure(t.mutate("suspendOrgCredentials", { orgId: id, credentialIds: ["c-bob"] }, ALICE))).code).toBe("SERVICE_UNAVAILABLE");
    expect(await t.store.suspendedCredentialIds(id)).toEqual([]);
    await t.mutate("suspendOrgCredentials", { orgId: id, credentialIds: ["c-bob"] }, ALICE);
    t.reactor.execute.mockImplementationOnce(() => Promise.reject(new Error("reactor down")));
    expect((await failure(t.mutate("unsuspendOrgCredential", { orgId: id, credentialId: "c-bob" }, ALICE))).code).toBe("SERVICE_UNAVAILABLE");
    expect(await t.store.suspendedCredentialIds(id)).toEqual(["c-bob"]);
  });
});
