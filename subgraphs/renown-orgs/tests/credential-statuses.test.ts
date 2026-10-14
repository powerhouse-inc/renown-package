// OrgPolicy.credentialStatuses: the set-based credentialStatus. It must give
// exactly the per-row verdicts, in a bounded number of queries.
import type { IRelationalDb } from "@powerhousedao/reactor-browser";
import { PGlite } from "@electric-sql/pglite";
import { Kysely, sql, type KyselyPlugin } from "kysely";
import { PGliteDialect } from "kysely-pglite-dialect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOrgPolicy, type CredentialStatusInput } from "../core/org-policy.js";
import { KyselyOrgStore } from "../store/kysely.js";
import { migrate } from "../store/migrations.js";
import { memberRecord, org } from "./store-contract.js";

const T0 = new Date("2026-10-01T00:00:00.000Z");
const HOUR = 3_600_000;
const at = (hours: number) => new Date(T0.getTime() + hours * HOUR);
const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

const APP = "did:key:z6MkApp1";
const APP_EXPLICIT = "did:key:z6MkAppExplicit";
const APP_TEAM = "did:key:z6MkAppTeam";
const APP_FROZEN = "did:key:z6MkAppFrozen";
const APP_ARCHIVED_ORG = "did:key:z6MkAppArchivedOrg";
const PERSON_APP = "did:key:z6MkPerson";
const APPS = [APP, APP_EXPLICIT, APP_TEAM, APP_FROZEN, APP_ARCHIVED_ORG, PERSON_APP];

const OWNER = addr(1);
const ADMIN = addr(2);
const PUB_ALL = addr(3);
const PUB_EXPLICIT = addr(4);
const PUB_TEAM = addr(5);
const MEMBER = addr(6);
const REMOVED = addr(7);
const SUSPENDED_MEMBER = addr(8);
const CRED_SUSPENDED = addr(9);
const ARCHIVED_ORG_PUB = addr(10);
const STRANGER = addr(11);
const ISSUERS = [OWNER, ADMIN, PUB_ALL, PUB_EXPLICIT, PUB_TEAM, MEMBER, REMOVED, SUSPENDED_MEMBER, CRED_SUSPENDED, ARCHIVED_ORG_PUB, STRANGER];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let root: Kysely<any>;
let queries = 0;
const counting: KyselyPlugin = {
  transformQuery: (args) => {
    queries++;
    return args.node;
  },
  transformResult: (args) => Promise.resolve(args.result),
};
let db: IRelationalDb<unknown>;

/** Mixed case for odd issuers, as a credential may carry a checksummed address. */
const mixed = (address: string, i: number) => (i % 2 ? address.toUpperCase().replace("0X", "0x") : address);

function matrix(): CredentialStatusInput[] {
  const inputs: CredentialStatusInput[] = [];
  let i = 0;
  for (const issuer of ISSUERS) {
    for (const appDid of APPS) {
      for (const issuedAt of [at(0), at(2)]) {
        const credentialId = `urn:uuid:${issuer}-${appDid}-${issuedAt.getTime()}`;
        inputs.push({ credentialId, appDid, issuer: mixed(issuer, i++), issuedAt });
      }
    }
  }
  return inputs;
}

beforeAll(async () => {
  root = new Kysely({ dialect: new PGliteDialect(new PGlite()) });
  await sql`create schema "renown-orgs"`.execute(root);
  await migrate(root.withSchema("renown-orgs"));
  db = { queryNamespace: (ns: string) => root.withSchema(ns).withPlugin(counting) } as unknown as IRelationalDb<unknown>;
  const store = new KyselyOrgStore(root.withSchema("renown-orgs"));
  await store.insertOrganization(org("o1", "acme"));
  await store.insertOrganization(org("o2", "gone", { archived: true }));
  const members: [string, string, Parameters<typeof memberRecord>[3]][] = [
    ["m-owner", OWNER, { role: "OWNER" }],
    ["m-admin", ADMIN, { role: "ADMIN" }],
    ["m-pub-all", PUB_ALL, { role: "PUBLISHER", appScopeAll: true }],
    ["m-pub-explicit", PUB_EXPLICIT, { role: "PUBLISHER", appDids: [APP_EXPLICIT] }],
    ["m-pub-team", PUB_TEAM, { role: "PUBLISHER" }],
    ["m-member", MEMBER, { role: "MEMBER", appScopeAll: true }],
    ["m-removed", REMOVED, { role: "PUBLISHER", appScopeAll: true, status: "REMOVED" }],
    ["m-susp", SUSPENDED_MEMBER, { role: "PUBLISHER", appScopeAll: true }],
    ["m-cred-susp", CRED_SUSPENDED, { role: "PUBLISHER", appScopeAll: true }],
  ];
  for (const [id, address, over] of members) await store.insertMember(memberRecord(id, "o1", address, over));
  await store.insertMember(memberRecord("m-o2", "o2", ARCHIVED_ORG_PUB, { role: "OWNER" }));
  await store.insertTeam({ id: "t1", orgId: "o1", slug: "team", name: "Team", appDids: [APP_TEAM], memberIds: ["m-pub-team"], createdAt: T0 });
  for (const appDid of [APP, APP_EXPLICIT, APP_TEAM]) await store.insertOrgApp({ appDid, orgId: "o1", frozen: false, addedAt: T0 });
  await store.insertOrgApp({ appDid: APP_FROZEN, orgId: "o1", frozen: true, addedAt: T0 });
  await store.insertOrgApp({ appDid: APP_ARCHIVED_ORG, orgId: "o2", frozen: false, addedAt: T0 });
  // Member-level suspension between the two issuance times: covers at(0), not at(2).
  await store.suspendMember({ orgId: "o1", address: SUSPENDED_MEMBER, reason: "MEMBER_LEFT", at: at(1) });
  const credSuspended = matrix().filter((input) => input.issuer.toLowerCase() === CRED_SUSPENDED && input.issuedAt.getTime() === T0.getTime());
  await store.suspendCredentials(
    credSuspended.map((input) => ({ orgId: "o1", credentialId: input.credentialId, reason: "ADMIN", memberAddress: CRED_SUSPENDED, at: T0 })),
  );
});

afterAll(async () => {
  await root.destroy();
});

describe("OrgPolicy.credentialStatuses", () => {
  it("gives exactly the per-row credentialStatus verdicts over the whole matrix", async () => {
    const policy = createOrgPolicy(db, "renown.test");
    const inputs = matrix();
    const single = [];
    for (const input of inputs) single.push(await policy.credentialStatus(input));
    const batch = await policy.credentialStatuses(inputs);
    expect(batch).toEqual(single);
    // The matrix really covers every outcome.
    expect(new Set(single.map((v) => v.reason))).toEqual(
      new Set([null, "APP_FROZEN", "SUSPENDED", "ISSUER_NOT_MEMBER", "ISSUER_NOT_PUBLISHER"]),
    );
    expect(single.filter((v) => v.orgId === null).every((v) => v.counts)).toBe(true);
  });

  it("reuses a known org_apps map and gives the same verdicts", async () => {
    const policy = createOrgPolicy(db, "renown.test");
    const inputs = matrix();
    const apps = await policy.orgsOfApps(APPS);
    expect(await policy.credentialStatuses(inputs, apps)).toEqual(await policy.credentialStatuses(inputs));
  });

  it("runs a bounded number of queries, however many rows", async () => {
    const policy = createOrgPolicy(db, "renown.test");
    const inputs = matrix();
    const apps = await policy.orgsOfApps(APPS);
    queries = 0;
    await policy.credentialStatuses(inputs.slice(0, 4), apps);
    const few = queries;
    queries = 0;
    await policy.credentialStatuses([...inputs, ...inputs, ...inputs], apps);
    expect(queries).toBeLessThanOrEqual(4);
    expect(few).toBeLessThanOrEqual(4);
    queries = 0;
    await policy.credentialStatuses(inputs);
    expect(queries).toBeLessThanOrEqual(5);
  });

  it("answers person apps and an empty list without reading members", async () => {
    const policy = createOrgPolicy(db, "renown.test");
    queries = 0;
    expect(await policy.credentialStatuses([])).toEqual([]);
    expect(queries).toBe(0);
    const verdicts = await policy.credentialStatuses([{ credentialId: "c", appDid: PERSON_APP, issuer: STRANGER, issuedAt: T0 }]);
    expect(verdicts).toEqual([{ orgId: null, counts: true, reason: null }]);
    expect(queries).toBe(1);
  });
});
