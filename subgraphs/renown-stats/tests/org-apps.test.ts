import { sql } from "kysely";
import { getAddress } from "viem";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createOrgPolicy } from "../../renown-orgs/core/org-policy.js";
import { KyselyOrgStore } from "../../renown-orgs/store/kysely.js";
import { migrate as migrateOrgs } from "../../renown-orgs/store/migrations.js";
import { memberRecord, org } from "../../renown-orgs/tests/store-contract.js";
import { failure, harnessResolvers, OWNER, openHarness, registerApp, relayed, resetHarness, WORKLOAD_NS, type Harness } from "./harness.js";

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
  for (const table of ["organizations", "org_members", "org_apps", "org_audit"] as const) await orgs.db.deleteFrom(table).execute();
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

function setup() {
  return harnessResolvers(h, { orgPolicy: () => createOrgPolicy(h.relationalDb, "renown.test") });
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

  it("finds an organisation's apps by its DID", async () => {
    await registerApps();
    const t = setup();
    await t.upsert({ appDid: APP, name: "Acme App", publisherOrgId: "o1" }, relayed(BOB));
    const byPublisher = (publisherDid: string) =>
      (t.resolvers as unknown as { Query: Record<string, (p: unknown, a: unknown, c: unknown) => Promise<{ appDid: string }[]>> }).Query.appProfilesByPublisher(null, { publisherDid }, {});
    expect((await byPublisher("did:web:www.renown.id:org:o1")).map((p) => p.appDid)).toEqual([APP]);
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
});
