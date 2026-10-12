import { sql } from "kysely";
import { getAddress } from "viem";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { actions as orgActions, type RenownOrganizationDocument } from "../../../document-models/renown-organization/index.js";
import { createOrgPolicy, type OrgPolicy } from "../../renown-orgs/core/org-policy.js";
import { KyselyOrgStore } from "../../renown-orgs/store/kysely.js";
import { migrate as migrateOrgs } from "../../renown-orgs/store/migrations.js";
import { memberRecord, org } from "../../renown-orgs/tests/store-contract.js";
import { CRED_NS, failure, harnessResolvers, OWNER, openHarness, registerApp, relayed, resetHarness, WORKLOAD_NS, type Harness } from "./harness.js";

const APP = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";
const PERSON_APP = "did:key:zDnaerDaTF5BXEavCrfRZEk316dpbLsfPDZ3WJ5hRTPFU2169";
/** Registered for organisation o2. */
const GLOBEX_APP = "did:key:z6MkjchhfUsD6mmvni8mCdXHw216Xrm9bQe2mBH1P5RDjVJG";
/** Registered for o1, but already attached to o2. */
const CONTESTED_APP = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doA";
const BOB = "0xb0b0000000000000000000000000000000000002";
const CAROL = "0xca40000000000000000000000000000000000003";
const DAVE = "0xda7e000000000000000000000000000000000005";
const ERIN = "0xe410000000000000000000000000000000000006";
let h: Harness;
let orgs: KyselyOrgStore;

beforeAll(async () => {
  h = await openHarness();
  await sql`create schema if not exists "renown-orgs"`.execute(h.root);
  await migrateOrgs(h.root.withSchema("renown-orgs"));
  orgs = new KyselyOrgStore(h.root.withSchema("renown-orgs"));
});
afterAll(async () => {
  await h.root.destroy();
});
beforeEach(async () => {
  await resetHarness(h);
  for (const table of ["organizations", "org_members", "org_apps", "org_audit", "org_domains", "org_credential_suspensions"] as const) await orgs.db.deleteFrom(table).execute();
  await orgs.insertOrganization(org("o1", "acme", { name: "Acme" }));
  await orgs.insertMember(memberRecord("m-owner", "o1", OWNER, { role: "OWNER", appScopeAll: true }));
  await orgs.insertMember(memberRecord("m-bob", "o1", BOB, { role: "PUBLISHER", appDids: [APP] }));
  await orgs.insertMember(memberRecord("m-carol", "o1", CAROL, { role: "PUBLISHER" }));
});

/** APP registered for organisation o1 (workload owner_org_id); PERSON_APP registered to OWNER. */
async function registerApps() {
  await registerApp(h, APP);
  await h.root.withSchema(WORKLOAD_NS).updateTable("workload_identities").set({ owner_org_id: "o1" }).where("did", "=", APP).execute();
  await registerApp(h, PERSON_APP);
}

/** Resolvers with the organisation documents of o1 and o2; `wrap` may alter the policy. */
function setup(wrap: (policy: OrgPolicy) => OrgPolicy = (policy) => policy) {
  const policy = wrap(createOrgPolicy(h.relationalDb, "renown.test"));
  const t = harnessResolvers(h, { orgPolicy: () => policy });
  t.reactor.seedOrganization("o1", "acme");
  t.reactor.seedOrganization("o2", "globex");
  return t;
}

/** The apps the organisation document `orgId` lists. */
function documentApps(t: ReturnType<typeof setup>, orgId: string): string[] {
  const doc = t.reactor.docs.get(orgId) as unknown as RenownOrganizationDocument;
  return doc.state.global.apps.map((app) => app.appDid);
}

describe("org-owned apps", () => {
  it("lets a publisher whose scope covers the app claim an org workload for the organisation", async () => {
    await registerApps();
    const t = setup();
    expect(await t.upsert({ appDid: APP, name: "Acme App", publisherOrgId: "o1" }, relayed(BOB))).toBe(true);
    expect(await t.appProfile(APP)).toMatchObject({
      name: "Acme App",
      publisherDid: "did:web:renown.test:org:o1",
      publisherOrg: { id: "o1", did: "did:web:renown.test:org:o1", handle: "acme", name: "Acme", verifiedDomains: [] },
      frozen: false,
    });
    expect(await orgs.orgOfApp(APP)).toMatchObject({ orgId: "o1", frozen: false });
    expect(documentApps(t, "o1")).toEqual([APP]);
    expect((await t.index.appProfile(APP))?.publisherOrgId).toBe("o1");
    expect((await t.appProfiles({ orgId: "o1" })).items.map((i) => i.appDid)).toEqual([APP]);
  });

  it("refuses outsiders, uncovered publishers, person claims of org workloads and org claims of person workloads", async () => {
    await registerApps();
    const t = setup();
    expect((await failure(t.upsert({ appDid: APP, name: "x", publisherOrgId: "o1" }, relayed("0xdead000000000000000000000000000000000004")))).code).toBe("FORBIDDEN");
    expect((await failure(t.upsert({ appDid: APP, name: "x", publisherOrgId: "o1" }, relayed(CAROL)))).code).toBe("FORBIDDEN");
    expect((await failure(t.upsert({ appDid: APP, name: "x" }, relayed(OWNER)))).code).toBe("FORBIDDEN");
    expect((await failure(t.upsert({ appDid: PERSON_APP, name: "x", publisherOrgId: "o1" }, relayed(OWNER)))).code).toBe("FORBIDDEN");
    expect(await t.upsert({ appDid: PERSON_APP, name: "Mine" }, relayed(OWNER))).toBe(true);
    expect(await failure(t.upsert({ appDid: PERSON_APP, name: "x", publisherOrgId: "o1" }, relayed(OWNER)))).toMatchObject({ code: "BAD_USER_INPUT", field: "publisherOrgId" });
    expect((await t.appProfile(PERSON_APP)) as Record<string, unknown>).toMatchObject({ publisherOrg: null, frozen: false });
  });

  it("lets covered publishers edit later, never a frozen app", async () => {
    await registerApps();
    const t = setup();
    await t.upsert({ appDid: APP, name: "Acme App", publisherOrgId: "o1" }, relayed(BOB));
    expect(await t.upsert({ appDid: APP, tagline: "By Acme" }, relayed(OWNER))).toBe(true);
    expect((await failure(t.upsert({ appDid: APP, tagline: "Mine" }, relayed(CAROL)))).code).toBe("FORBIDDEN");
    await orgs.db.updateTable("org_apps").set({ frozen: true }).where("app_did", "=", APP).execute();
    expect((await failure(t.upsert({ appDid: APP, tagline: "Again" }, relayed(BOB)))).code).toBe("APP_FROZEN");
    expect(await t.appProfile(APP)).toMatchObject({ tagline: "By Acme", frozen: true });
  });

  it("finds an organisation's apps by its DID on this host only", async () => {
    await registerApps();
    const t = setup();
    await t.upsert({ appDid: APP, name: "Acme App", publisherOrgId: "o1" }, relayed(BOB));
    const byPublisher = (publisherDid: string) =>
      (t.resolvers as unknown as { Query: Record<string, (p: unknown, a: unknown, c: unknown) => Promise<{ appDid: string }[]>> }).Query.appProfilesByPublisher(null, { publisherDid }, {});
    expect((await byPublisher("did:web:renown.test:org:o1")).map((p) => p.appDid)).toEqual([APP]);
    expect((await failure(byPublisher("did:web:www.renown.id:org:o1"))).code).toBe("BAD_USER_INPUT");
    expect((await byPublisher(`did:pkh:eip155:1:${getAddress(BOB)}`)).map((p) => p.appDid)).toEqual([APP]);
  });

  it("never lets one organisation's publishers act on another organisation's app or on a person's app", async () => {
    await registerApps();
    await orgs.insertOrganization(org("o2", "globex", { name: "Globex" }));
    await orgs.insertMember(memberRecord("m-dave", "o2", DAVE, { role: "OWNER", appScopeAll: true }));
    await orgs.insertMember(memberRecord("m-erin", "o1", ERIN, { role: "ADMIN", appScopeAll: true }));
    await registerApp(h, GLOBEX_APP);
    await registerApp(h, CONTESTED_APP);
    const workloads = h.root.withSchema(WORKLOAD_NS).updateTable("workload_identities");
    await workloads.set({ owner_org_id: "o2" }).where("did", "=", GLOBEX_APP).execute();
    await workloads.set({ owner_org_id: "o1" }).where("did", "=", CONTESTED_APP).execute();
    await orgs.db.insertInto("org_apps").values({ app_did: CONTESTED_APP, org_id: "o2", frozen: false, added_at: new Date("2026-10-01T00:00:00Z") }).execute();
    const t = setup();

    // First claims: the workload must belong to the organisation, and the app to no other one.
    expect((await failure(t.upsert({ appDid: GLOBEX_APP, name: "x", publisherOrgId: "o1" }, relayed(OWNER)))).code).toBe("FORBIDDEN");
    expect((await failure(t.upsert({ appDid: CONTESTED_APP, name: "x", publisherOrgId: "o1" }, relayed(OWNER)))).code).toBe("FORBIDDEN");
    expect(await t.upsert({ appDid: GLOBEX_APP, name: "Globex App", publisherOrgId: "o2" }, relayed(DAVE))).toBe(true);

    // Later writes: an o1 owner (scope ALL) cannot write o2's app.
    expect((await failure(t.upsert({ appDid: GLOBEX_APP, tagline: "x" }, relayed(OWNER)))).code).toBe("FORBIDDEN");
    expect((await failure(t.upsert({ appDid: GLOBEX_APP, tagline: "x", publisherOrgId: "o2" }, relayed(OWNER)))).code).toBe("FORBIDDEN");

    // Nor a person's app.
    expect(await t.upsert({ appDid: PERSON_APP, name: "Mine" }, relayed(OWNER))).toBe(true);
    expect((await failure(t.upsert({ appDid: PERSON_APP, tagline: "x" }, relayed(ERIN)))).code).toBe("FORBIDDEN");

    // An org profile whose app now belongs to another organisation is writable by neither.
    await t.upsert({ appDid: APP, name: "Acme App", publisherOrgId: "o1" }, relayed(BOB));
    await orgs.db.updateTable("org_apps").set({ org_id: "o2" }).where("app_did", "=", APP).execute();
    expect((await failure(t.upsert({ appDid: APP, tagline: "x" }, relayed(BOB)))).code).toBe("FORBIDDEN");
    expect((await failure(t.upsert({ appDid: APP, tagline: "x" }, relayed(DAVE)))).code).toBe("FORBIDDEN");

    // A person's profile whose app was attached to an organisation is no longer the person's alone.
    await orgs.db.insertInto("org_apps").values({ app_did: PERSON_APP, org_id: "o1", frozen: false, added_at: new Date("2026-10-01T00:00:00Z") }).execute();
    expect((await failure(t.upsert({ appDid: PERSON_APP, tagline: "x" }, relayed(OWNER)))).code).toBe("FORBIDDEN");
    expect(await t.appProfile(GLOBEX_APP)).toMatchObject({ tagline: null, publisherOrg: { id: "o2", handle: "globex" } });
  });

  it("attaches before claiming: an app another organisation took meanwhile is refused without recording the org", async () => {
    await registerApps();
    await registerApp(h, CONTESTED_APP);
    await h.root.withSchema(WORKLOAD_NS).updateTable("workload_identities").set({ owner_org_id: "o1" }).where("did", "=", CONTESTED_APP).execute();
    await orgs.db.insertInto("org_apps").values({ app_did: CONTESTED_APP, org_id: "o2", frozen: false, added_at: new Date("2026-10-01T00:00:00Z") }).execute();
    let stale = true;
    // The first ownership read predates the other organisation's attach.
    const t = setup((policy) => ({
      ...policy,
      orgOfApp: (appDid) => {
        if (!stale) return policy.orgOfApp(appDid);
        stale = false;
        return Promise.resolve(null);
      },
    }));
    expect((await failure(t.upsert({ appDid: CONTESTED_APP, name: "x", publisherOrgId: "o1" }, relayed(OWNER)))).code).toBe("FORBIDDEN");
    expect(await t.index.appProfile(CONTESTED_APP)).toBeUndefined();
    expect(t.reactor.createEmpty).not.toHaveBeenCalled();
    expect(await orgs.orgOfApp(CONTESTED_APP)).toMatchObject({ orgId: "o2" });
  });

  it("undoes its attach when the claim fails or loses", async () => {
    await registerApps();
    const failing = setup();
    failing.reactor.createEmpty.mockRejectedValueOnce(new Error("reactor down"));
    await expect(failing.upsert({ appDid: APP, name: "x", publisherOrgId: "o1" }, relayed(BOB))).rejects.toThrow("reactor down");
    expect(await orgs.orgOfApp(APP)).toBeUndefined();

    // Another process claims the profile (for the person) between our attach and our claim.
    let rival: ReturnType<typeof setup> | undefined;
    const t = setup((policy) => ({
      ...policy,
      attachApp: async (...args) => {
        const attached = await policy.attachApp(...args);
        await rival?.index.claimAppProfile({ appDid: APP, documentId: "rival", publisherAddress: OWNER }, new Date("2026-10-01T00:00:00Z"));
        return attached;
      },
    }));
    rival = t;
    expect((await failure(t.upsert({ appDid: APP, name: "x", publisherOrgId: "o1" }, relayed(BOB)))).code).toBe("FORBIDDEN");
    expect(await orgs.orgOfApp(APP)).toBeUndefined();
    expect((await t.index.appProfile(APP))?.publisherOrgId).toBeUndefined();
    expect(documentApps(t, "o1")).toEqual([]);
    expect((await orgs.db.selectFrom("org_audit").select("action").where("org_id", "=", "o1").execute()).map((r) => r.action).sort()).toEqual([
      "attachApp",
      "attachApp",
      "detachApp",
      "detachApp",
    ]);
  });

  it("re-attaches an org profile whose org_apps row was lost, for covered publishers only", async () => {
    await registerApps();
    const t = setup();
    await t.upsert({ appDid: APP, name: "Acme App", publisherOrgId: "o1" }, relayed(BOB));
    await orgs.db.deleteFrom("org_apps").where("app_did", "=", APP).execute();
    expect((await failure(t.upsert({ appDid: APP, tagline: "x" }, relayed(CAROL)))).code).toBe("FORBIDDEN");
    expect(await orgs.orgOfApp(APP)).toBeUndefined();
    expect(await t.upsert({ appDid: APP, tagline: "Repaired" }, relayed(BOB))).toBe(true);
    expect(await orgs.orgOfApp(APP)).toMatchObject({ orgId: "o1" });
    expect(documentApps(t, "o1")).toEqual([APP]);
    expect(await t.appProfile(APP)).toMatchObject({ tagline: "Repaired", publisherOrg: { id: "o1" } });
  });

  it("logs organisation document mirrors that fail or that the reducer rejects, without failing the claim", async () => {
    await registerApps();
    await registerApp(h, GLOBEX_APP);
    await h.root.withSchema(WORKLOAD_NS).updateTable("workload_identities").set({ owner_org_id: "o1" }).where("did", "=", GLOBEX_APP).execute();
    const t = setup();
    // A stale read: the document already lists APP, so the reducer rejects a second addOrgApp.
    const stale = t.reactor.docs.get("o1");
    await t.reactor.execute("o1", "main", [orgActions.addOrgApp({ appDid: APP, addedAt: "2026-10-01T00:00:00.000Z" })]);
    t.reactor.get.mockResolvedValueOnce(stale as never);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(await t.upsert({ appDid: APP, name: "Acme App", publisherOrgId: "o1" }, relayed(BOB))).toBe(true);
      expect(warn).toHaveBeenLastCalledWith(expect.stringMatching(/organisation document mirror failed \(ADD_ORG_APP failed: .*already belongs/));
      // No organisation document at all.
      t.reactor.docs.delete("o1");
      expect(await t.upsert({ appDid: GLOBEX_APP, name: "Other", publisherOrgId: "o1" }, relayed(OWNER))).toBe(true);
      expect(warn).toHaveBeenLastCalledWith(expect.stringContaining("organisation document mirror failed (no document o1)"));
    } finally {
      warn.mockRestore();
    }
    expect(await orgs.orgOfApp(APP)).toMatchObject({ orgId: "o1" });
    expect(await orgs.orgOfApp(GLOBEX_APP)).toMatchObject({ orgId: "o1" });
  });

  it("answers SERVICE_UNAVAILABLE when organisations cannot be read", async () => {
    await registerApps();
    const t = setup((policy) => ({ ...policy, orgOfApp: () => Promise.reject(new Error("db down")) }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect((await failure(t.upsert({ appDid: PERSON_APP, name: "x" }, relayed(OWNER)))).code).toBe("SERVICE_UNAVAILABLE");
    } finally {
      warn.mockRestore();
    }
  });

  it("lists a page of apps of several organisations with their cards in batched lookups", async () => {
    await registerApps();
    await orgs.insertOrganization(org("o2", "globex", { name: "Globex" }));
    await orgs.insertMember(memberRecord("m-dave", "o2", DAVE, { role: "OWNER", appScopeAll: true }));
    await registerApp(h, GLOBEX_APP);
    await h.root.withSchema(WORKLOAD_NS).updateTable("workload_identities").set({ owner_org_id: "o2" }).where("did", "=", GLOBEX_APP).execute();
    const at = new Date("2026-10-01T00:00:00Z");
    for (const [id, orgId, domain, status] of [
      ["d1", "o1", "b.acme.example", "VERIFIED"],
      ["d2", "o1", "a.acme.example", "VERIFIED"],
      ["d3", "o2", "globex.example", "PENDING"],
    ] as const) {
      await orgs.db.insertInto("org_domains").values({ id, org_id: orgId, domain, token: "t", status, verified_at: null, last_checked_at: null, failures: 0, created_at: at }).execute();
    }
    const t = setup();
    await t.upsert({ appDid: APP, name: "Acme App", publisherOrgId: "o1" }, relayed(BOB));
    await t.upsert({ appDid: GLOBEX_APP, name: "Globex App", publisherOrgId: "o2" }, relayed(DAVE));
    await t.upsert({ appDid: PERSON_APP, name: "Mine" }, relayed(OWNER));
    await orgs.db.updateTable("org_apps").set({ frozen: true }).where("app_did", "=", GLOBEX_APP).execute();
    const page = (await t.appProfiles({})).items as unknown as { appDid: string; publisherOrg: { id: string; verifiedDomains: string[] } | null; frozen: boolean }[];
    expect(page.map((p) => [p.appDid, p.publisherOrg?.id ?? null, p.publisherOrg?.verifiedDomains ?? null, p.frozen])).toEqual([
      [PERSON_APP, null, null, false],
      [GLOBEX_APP, "o2", [], true],
      [APP, "o1", ["a.acme.example", "b.acme.example"], false],
    ]);
  });
});

/** A copy of OWNER's delegation to `appDid`, issued by `issuer` as `credentialId`. */
async function delegate(issuer: string, appDid: string, credentialId: string) {
  const source = await h.root.withSchema(CRED_NS).selectFrom("renown_credential").selectAll().where("credential_subject_id", "=", appDid).executeTakeFirstOrThrow();
  await h.root
    .withSchema(CRED_NS)
    .insertInto("renown_credential")
    .values({ ...source, document_id: `doc-${credentialId}`, credential_id: credentialId, issuer_ethereum_address: issuer, proof_ethereum_address: issuer, created_at: undefined, updated_at: undefined })
    .execute();
}

describe("delegations of org apps", () => {
  const userDid = "did:pkh:eip155:1:0x1111111111111111111111111111111111111111";

  it("count for covered publishers only, and never for a frozen app", async () => {
    await registerApps();
    await orgs.db.insertInto("org_apps").values({ app_did: APP, org_id: "o1", frozen: false, added_at: new Date() }).execute();
    const t = setup();
    const report = { appDid: APP, userDid, metric: "notes", value: 1 };
    expect(await t.report(report)).toBe(true);
    await orgs.db.updateTable("org_members").set({ status: "REMOVED" }).where("address", "=", OWNER).execute();
    expect((await failure(t.report(report))).code).toBe("FORBIDDEN");
    await orgs.db.updateTable("org_members").set({ status: "ACTIVE" }).where("address", "=", OWNER).execute();
    await orgs.db.updateTable("org_apps").set({ frozen: true }).execute();
    expect((await failure(t.report(report))).code).toBe("FORBIDDEN");
  });

  it("let any covered publisher act for an org workload, never an uncovered one or a suspended delegation", async () => {
    await registerApps();
    await orgs.db.insertInto("org_apps").values({ app_did: APP, org_id: "o1", frozen: false, added_at: new Date() }).execute();
    await delegate(BOB, APP, "c-bob");
    await delegate(CAROL, APP, "c-carol");
    const t = setup();
    const as = (address: string) =>
      (t.resolvers as unknown as { Mutation: Record<string, (p: unknown, a: unknown, c: unknown) => Promise<boolean>> }).Mutation.reportUserStat(
        null,
        { appDid: APP, userDid, metric: "notes", value: 1 },
        { user: { address, appKey: APP } },
      );
    expect(await as(BOB)).toBe(true);
    expect((await failure(as(CAROL))).code).toBe("FORBIDDEN");
    await orgs.suspendCredentials([{ orgId: "o1", credentialId: "c-bob", reason: "ADMIN", memberAddress: null, at: new Date() }]);
    expect((await failure(as(BOB))).code).toBe("FORBIDDEN");
  });

  it("fail closed for org apps and leave person apps alone when organisations cannot be read", async () => {
    await registerApps();
    await orgs.db.insertInto("org_apps").values({ app_did: APP, org_id: "o1", frozen: false, added_at: new Date() }).execute();
    const down = new Error("connection refused");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const t = setup((policy) => ({
      ...policy,
      coversApp: () => Promise.reject(down),
      credentialStatus: () => Promise.reject(down),
      orgOfApp: () => Promise.reject(down),
    }));
    expect((await failure(t.report({ appDid: APP, userDid, metric: "notes", value: 1 }))).code).toBe("FORBIDDEN");
    expect(await t.report({ appDid: PERSON_APP, userDid, metric: "notes", value: 1 })).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("connection refused"));
    warn.mockRestore();
  });
});
