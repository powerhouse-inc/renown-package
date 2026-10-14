// renownCredentials(includeRevoked: false) is what a host's credential check
// reads (RENOWN_SOURCE=self: @renown/sdk getCredential through the local
// verifier). A delegation that no longer counts under organisation rules
// (spec 3.7 derived revocation) must drop out of those live results, so the
// bearer stops authenticating; person-app delegations are unaffected.
import { PGlite } from "@electric-sql/pglite";
import type { ISubgraph } from "@powerhousedao/reactor-api";
import { Kysely, sql } from "kysely";
import { PGliteDialect } from "kysely-pglite-dialect";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RenownCredentialProcessor } from "../../../processors/renown-credential/index.js";
import { up } from "../../../processors/renown-credential/migrations.js";
import { KyselyOrgStore } from "../../renown-orgs/store/kysely.js";
import { migrate } from "../../renown-orgs/store/migrations.js";
import { memberRecord, org } from "../../renown-orgs/tests/store-contract.js";
import { getResolvers } from "../resolvers.js";

const CRED_NS = RenownCredentialProcessor.getNamespace("renown-credential");
const ALICE = "0xabc0000000000000000000000000000000000001";
const BOB = "0xabc0000000000000000000000000000000000002";
const ORG_APP = "did:key:z6MkOrgAppOrgAppOrgAppOrgAppOrgAppOrgAppOrgApp";
const PERSON_APP = "did:key:z6MkPersonAppPersonAppPersonAppPersonAppPersonA";
const T0 = new Date("2026-10-01T00:00:00.000Z");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let root: Kysely<any>;
let store: KyselyOrgStore;
type Field = (parent: unknown, args: unknown) => Promise<unknown>;
let query: Record<string, Field>;
type Row = { credentialId: string; revoked: boolean };

async function credential(credentialId: string, owner: string, appDid: string): Promise<void> {
  await root.withSchema(CRED_NS).insertInto("renown_credential").values({
    document_id: `doc-${credentialId}`,
    context: "[]",
    credential_id: credentialId,
    type: '["VerifiableCredential","RenownCredential"]',
    issuer_id: `did:pkh:eip155:1:${owner}`,
    issuer_ethereum_address: owner,
    issuance_date: T0,
    expiration_date: null,
    credential_subject_id: appDid,
    credential_subject_app: "test-app",
    credential_status_id: null,
    credential_status_type: null,
    credential_schema_id: "schema",
    credential_schema_type: "type",
    proof_verification_method: "method",
    proof_ethereum_address: owner,
    proof_created: T0,
    proof_purpose: "assertionMethod",
    proof_type: "EthereumEip712Signature2021",
    proof_value: "0x",
    proof_eip712_domain: "{}",
    proof_eip712_primary_type: "VerifiableCredential",
    revoked: false,
    revoked_at: null,
    revocation_reason: null,
  }).execute();
}

/** The host's query: @renown/sdk SwitchboardClient.getCredential. */
async function live(address: string, did: string): Promise<string[]> {
  const rows = (await query.renownCredentials(null, {
    input: { driveId: "renown-user", ethAddress: address, did, includeRevoked: false },
  })) as Row[];
  return rows.map((row) => row.credentialId).sort();
}

async function all(address: string, did: string): Promise<Row[]> {
  return (await query.renownCredentials(null, { input: { ethAddress: address, did, includeRevoked: true } })) as Row[];
}

beforeAll(async () => {
  root = new Kysely({ dialect: new PGliteDialect(new PGlite()) });
  await sql`create schema ${sql.id(CRED_NS)}`.execute(root);
  await up(root.withSchema(CRED_NS) as never);
  await sql`create schema "renown-orgs"`.execute(root);
  await migrate(root.withSchema("renown-orgs"));
  store = new KyselyOrgStore(root.withSchema("renown-orgs"));
  const subgraph = { relationalDb: { queryNamespace: (ns: string) => root.withSchema(ns) } } as unknown as ISubgraph;
  query = (getResolvers(subgraph) as { Query: Record<string, Field> }).Query;
});

afterAll(async () => {
  await root.destroy();
});

beforeEach(async () => {
  await root.withSchema(CRED_NS).deleteFrom("renown_credential").execute();
  for (const table of ["org_credential_suspensions", "org_member_suspensions", "org_apps", "org_members", "organizations"]) {
    await root.withSchema("renown-orgs").deleteFrom(table).execute();
  }
  await store.insertOrganization(org("o1", "acme"));
  await store.insertMember(memberRecord("m-alice", "o1", ALICE, { role: "PUBLISHER", appScopeAll: true }));
  await store.insertOrgApp({ appDid: ORG_APP, orgId: "o1", frozen: false, addedAt: T0 });
  await credential("urn:uuid:org-alice", ALICE, ORG_APP);
  await credential("urn:uuid:org-bob", BOB, ORG_APP);
  await credential("urn:uuid:person-alice", ALICE, PERSON_APP);
});

describe("renownCredentials(includeRevoked: false) applies organisation rules", () => {
  it("keeps a delegation that counts, and person-app delegations", async () => {
    expect(await live(ALICE, ORG_APP)).toEqual(["urn:uuid:org-alice"]);
    expect(await live(ALICE, PERSON_APP)).toEqual(["urn:uuid:person-alice"]);
  });

  it("drops a delegation whose issuer is not a member (ISSUER_NOT_MEMBER)", async () => {
    expect(await live(BOB, ORG_APP)).toEqual([]);
    // Still listed, as not revoked, when the caller asks for every row.
    expect(await all(BOB, ORG_APP)).toEqual([expect.objectContaining({ credentialId: "urn:uuid:org-bob", revoked: false })]);
  });

  it("drops a removed member's delegation and keeps their person-app one", async () => {
    await store.updateMember("m-alice", { status: "REMOVED", updatedAt: T0 });
    expect(await live(ALICE, ORG_APP)).toEqual([]);
    expect(await live(ALICE, PERSON_APP)).toEqual(["urn:uuid:person-alice"]);
  });

  it("drops a demoted member's delegation (ISSUER_NOT_PUBLISHER)", async () => {
    await store.updateMember("m-alice", { role: "MEMBER", appScopeAll: false, updatedAt: T0 });
    expect(await live(ALICE, ORG_APP)).toEqual([]);
  });

  it("drops a suspended credential", async () => {
    await store.suspendCredentials([
      { orgId: "o1", credentialId: "urn:uuid:org-alice", reason: "ADMIN", memberAddress: ALICE, at: T0 },
    ]);
    expect(await live(ALICE, ORG_APP)).toEqual([]);
  });

  it("drops delegations issued up to a member-level suspension, not later ones", async () => {
    // Suspended exactly at issuance (compared in UTC): covered.
    await store.suspendMember({ orgId: "o1", address: ALICE, reason: "MEMBER_LEFT", at: T0 });
    expect(await live(ALICE, ORG_APP)).toEqual([]);
    await store.liftMemberSuspension("o1", ALICE);
    await store.suspendMember({ orgId: "o1", address: ALICE, reason: "MEMBER_LEFT", at: new Date(T0.getTime() - 1000) });
    expect(await live(ALICE, ORG_APP)).toEqual(["urn:uuid:org-alice"]);
  });

  it("drops every delegation of a frozen app", async () => {
    await store.setAppFrozen(ORG_APP, true);
    expect(await live(ALICE, ORG_APP)).toEqual([]);
    await store.setAppFrozen(ORG_APP, false);
    expect(await live(ALICE, ORG_APP)).toEqual(["urn:uuid:org-alice"]);
  });

  it("applies the rules to broad queries too (issuer only)", async () => {
    await store.updateMember("m-alice", { status: "REMOVED", updatedAt: T0 });
    const rows = (await query.renownCredentials(null, { input: { issuer: ALICE, includeRevoked: false } })) as Row[];
    expect(rows.map((row) => row.credentialId)).toEqual(["urn:uuid:person-alice"]);
  });
});

describe("renownCredentials organisation lookups", () => {
  it("leaves results alone when no organisation namespace exists", async () => {
    const bare = {
      relationalDb: {
        queryNamespace: (ns: string) => (ns === "renown-orgs" ? root.withSchema("no-such-namespace") : root.withSchema(ns)),
      },
    } as unknown as ISubgraph;
    const q = (getResolvers(bare) as { Query: Record<string, Field> }).Query;
    const rows = (await q.renownCredentials(null, { input: { ethAddress: BOB, did: ORG_APP, includeRevoked: false } })) as Row[];
    expect(rows.map((row) => row.credentialId)).toEqual(["urn:uuid:org-bob"]);
  });

  it("fails closed when the organisation read fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const broken = {
      relationalDb: {
        queryNamespace: (ns: string) => {
          if (ns === "renown-orgs") throw new Error("connection refused");
          return root.withSchema(ns);
        },
      },
    } as unknown as ISubgraph;
    const q = (getResolvers(broken) as { Query: Record<string, Field> }).Query;
    await expect(
      q.renownCredentials(null, { input: { ethAddress: ALICE, did: PERSON_APP, includeRevoked: false } }),
    ).rejects.toMatchObject({ extensions: { code: "SERVICE_UNAVAILABLE" } });
    // includeRevoked: true never reads organisations.
    const rows = (await q.renownCredentials(null, { input: { ethAddress: ALICE, did: PERSON_APP, includeRevoked: true } })) as Row[];
    expect(rows).toHaveLength(1);
    warn.mockRestore();
  });
});
