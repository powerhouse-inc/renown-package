import { PGlite } from "@electric-sql/pglite";
import type { ISubgraph } from "@powerhousedao/reactor-api";
import { Kysely, sql } from "kysely";
import { PGliteDialect } from "kysely-pglite-dialect";
import { print } from "graphql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RenownCredentialProcessor } from "../../../processors/renown-credential/index.js";
import { up } from "../../../processors/renown-credential/migrations.js";
import type { DB } from "../../../processors/renown-credential/schema.js";
import { getResolvers } from "../resolvers.js";
import { schema } from "../schema.js";

const NS = RenownCredentialProcessor.getNamespace("renown-credential");
const ALICE = "0xabc0000000000000000000000000000000000001";
const BOB = "0xabc0000000000000000000000000000000000002";
const APP = "did:key:z6MkAppAppAppAppAppAppAppAppAppAppAppAppAppApp";
const T0 = new Date("2026-10-01T00:00:00.000Z");
let root: Kysely<DB>;

type Query = Record<string, (parent: unknown, args: unknown) => Promise<unknown>>;
let query: Query;

async function credential(documentId: string, credentialId: string, owner: string, revoked = false): Promise<void> {
  await root.withSchema(NS).insertInto("renown_credential").values({
    document_id: documentId,
    context: "[]",
    credential_id: credentialId,
    type: '["VerifiableCredential","RenownCredential"]',
    issuer_id: `did:pkh:eip155:1:${owner}`,
    issuer_ethereum_address: owner,
    issuance_date: T0,
    expiration_date: null,
    credential_subject_id: APP,
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
    revoked,
    revoked_at: revoked ? T0 : null,
    revocation_reason: revoked ? "user" : null,
  }).execute();
}

beforeAll(async () => {
  root = new Kysely<DB>({ dialect: new PGliteDialect(new PGlite()) });
  await sql`create schema ${sql.id(NS)}`.execute(root);
  await up(root.withSchema(NS) as never);
  await credential("doc-1", "urn:uuid:11111111-1111-4111-8111-111111111111", ALICE);
  await credential("doc-2", "urn:uuid:22222222-2222-4222-8222-222222222222", BOB, true);
  await credential("doc-3", "urn:uuid:33333333-3333-4333-8333-333333333333", ALICE);
  const subgraph = { relationalDb: { queryNamespace: (ns: string) => root.withSchema(ns) } } as unknown as ISubgraph;
  query = (getResolvers(subgraph) as { Query: Query }).Query;
});

afterAll(async () => {
  await root.destroy();
});

type Row = { documentId: string; credentialId: string; revoked: boolean };
const ids = (rows: unknown) => (rows as Row[]).map((r) => r.documentId).sort();

describe("renownCredentials(credentialId)", () => {
  it("declares credentialId on the input", () => {
    expect(print(schema)).toMatch(/input RenownCredentialsInput \{[^}]*credentialId: String/);
  });

  it("finds one credential by its exact id, without an address or issuer", async () => {
    const rows = (await query.renownCredentials(null, {
      input: { credentialId: "urn:uuid:22222222-2222-4222-8222-222222222222" },
    })) as Row[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ documentId: "doc-2", revoked: true });
  });

  it("matches exactly: no prefix, no case folding, unknown ids return nothing", async () => {
    for (const credentialId of ["urn:uuid:2222", "URN:UUID:22222222-2222-4222-8222-222222222222", "urn:uuid:nope"]) {
      expect(await query.renownCredentials(null, { input: { credentialId } })).toEqual([]);
    }
  });

  it("treats an empty credentialId as a filter that matches nothing, never as no filter", async () => {
    expect(await query.renownCredentials(null, { input: { credentialId: "" } })).toEqual([]);
  });

  it("combines with the other filters", async () => {
    const id2 = "urn:uuid:22222222-2222-4222-8222-222222222222";
    expect(await query.renownCredentials(null, { input: { credentialId: id2, includeRevoked: false } })).toEqual([]);
    expect(await query.renownCredentials(null, { input: { credentialId: id2, ethAddress: ALICE } })).toEqual([]);
    expect(ids(await query.renownCredentials(null, { input: { credentialId: id2, did: APP, issuer: BOB } }))).toEqual(["doc-2"]);
  });

  it("leaves the other filters unchanged when credentialId is absent", async () => {
    expect(ids(await query.renownCredentials(null, { input: { ethAddress: ALICE } }))).toEqual(["doc-1", "doc-3"]);
  });
});
