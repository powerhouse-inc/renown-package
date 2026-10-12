import { PGlite } from "@electric-sql/pglite";
import type { IRelationalDb } from "@powerhousedao/reactor-browser";
import type { Action, PHDocument } from "document-model";
import { GraphQLError } from "graphql";
import { Kysely, sql } from "kysely";
import { PGliteDialect } from "kysely-pglite-dialect";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { expect, vi } from "vitest";
import {
  actions as profileActions,
  reducer as profileReducer,
  renownAppProfileDocumentType,
  utils as profileUtils,
} from "../../../document-models/renown-app-profile/index.js";
import {
  reducer as orgReducer,
  renownOrganizationDocumentType,
  utils as orgUtils,
} from "../../../document-models/renown-organization/index.js";
import type { MediaBackend } from "../../../media/backend.js";
import { RenownCredentialProcessor } from "../../../processors/renown-credential/index.js";
import { up as upCredential } from "../../../processors/renown-credential/migrations.js";
import { RenownUserProcessor } from "../../../processors/renown-user/index.js";
import { up as upUser } from "../../../processors/renown-user/migrations.js";
import { pkhDidFor } from "../../renown-stats/core/dids.js";
import { migrate as migrateStats } from "../../renown-stats/store/migrations.js";
import { migrate as migrateWorkload } from "../../renown-workload/store/migrations.js";
import { orgMessage } from "../../../sdk/orgs.js";
import type { OrgAuthInput } from "../core/auth.js";
import type { OrgsConfig } from "../core/config.js";
import type { OrganizationOutput } from "../output.js";
import { resolversFor } from "../resolvers.js";
import { createRuntime } from "../runtime.js";
import type { OrgsResolverDeps } from "../runtime.js";
import { KyselyOrgStore } from "../store/kysely.js";
import { migrate } from "../store/migrations.js";
import { ORGS_NAMESPACE } from "../store/types.js";

// Hardhat's well-known test keys.
export const ALICE = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
export const BOB = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
export const CAROL = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
export const DAVE = privateKeyToAccount("0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6");
export const EVE = privateKeyToAccount("0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a");
export const lower = (account: { address: string }) => account.address.toLowerCase();

export const T0 = new Date("2026-10-12T12:00:00.000Z");
export const USER_NS = RenownUserProcessor.getNamespace("renown-user");
export const CRED_NS = RenownCredentialProcessor.getNamespace("renown-credential");
export const WORKLOAD_NS = "renown-workload";
export const STATS_NS = "renown-stats";
export const TEST_CONFIG: OrgsConfig = {
  didHost: "renown.test",
  timelockSeconds: 3600,
  recoverySeconds: 7200,
  platformAdmins: new Set([lower(EVE)]),
};

export interface Harness {
  root: Kysely<any>;
  relationalDb: IRelationalDb<unknown>;
}

/** One PGlite with every namespace renown-orgs reads: its own, the user and credential read models. */
export async function openHarness(): Promise<Harness> {
  const root = new Kysely<any>({ dialect: new PGliteDialect(new PGlite()) });
  await sql`create schema ${sql.id(ORGS_NAMESPACE)}`.execute(root);
  await migrate(root.withSchema(ORGS_NAMESPACE));
  await sql`create schema ${sql.id(USER_NS)}`.execute(root);
  await upUser(root.withSchema(USER_NS) as never);
  await sql`create schema ${sql.id(CRED_NS)}`.execute(root);
  await upCredential(root.withSchema(CRED_NS) as never);
  await sql`create schema ${sql.id(WORKLOAD_NS)}`.execute(root);
  await migrateWorkload(root.withSchema(WORKLOAD_NS));
  await sql`create schema ${sql.id(STATS_NS)}`.execute(root);
  await migrateStats(root.withSchema(STATS_NS));
  // Like the host: queryNamespace reads, createNamespace hands out a writable handle.
  const relationalDb = {
    queryNamespace: (namespace: string) => root.withSchema(namespace),
    createNamespace: (namespace: string) => Promise.resolve(root.withSchema(namespace)),
  } as unknown as IRelationalDb<unknown>;
  return { root, relationalDb };
}

/** Empties every table of every namespace the harness created (later phases add tables; this follows). */
export async function resetHarness(h: Harness): Promise<void> {
  for (const schema of [ORGS_NAMESPACE, USER_NS, CRED_NS, WORKLOAD_NS, STATS_NS]) {
    const { rows } = await sql<{ table_name: string }>`
      select table_name from information_schema.tables where table_schema = ${schema}`.execute(h.root);
    for (const { table_name } of rows) await h.root.withSchema(schema).deleteFrom(table_name).execute();
  }
}

/** A Renown profile row, as the renown-user processor writes it. */
export async function insertUser(h: Harness, row: { address: string; handle?: string | null; documentId: string; displayName?: string | null }): Promise<void> {
  await h.root
    .withSchema(USER_NS)
    .insertInto("renown_user")
    .values({
      document_id: row.documentId,
      eth_address: row.address,
      username: null,
      user_image: null,
      display_name: row.displayName ?? null,
      handle: row.handle ?? null,
      bio: null,
      links: "[]",
      avatar_ref: null,
      created_at: T0,
      updated_at: T0,
    })
    .execute();
}

/** A workload identity row as renown-workload stores it. */
export async function insertWorkload(
  h: Harness,
  row: { did: string; owner: string; ownerOrgId?: string | null; disabled?: boolean; repositoryId?: string },
): Promise<void> {
  await h.root
    .withSchema(WORKLOAD_NS)
    .insertInto("workload_identities")
    .values({
      did: row.did,
      provider: "github",
      repository_id: row.repositoryId ?? row.did.slice(-12),
      repository: "acme/app",
      production_branch: "main",
      owner_address: row.owner,
      chain_id: 1,
      encrypted_key_pair: "sealed",
      created_at: T0,
      updated_at: T0,
      owner_org_id: row.ownerOrgId ?? null,
      disabled: row.disabled ?? false,
    })
    .execute();
}

/** A media backend holding a valid PNG for every hash (or nothing, with `stored: false`). */
export function pngMedia(stored = true): MediaBackend {
  const head = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return {
    kind: "s3",
    reserve: vi.fn(),
    serve: vi.fn(),
    inspect: vi.fn(() => Promise.resolve(stored ? { mimeType: "image/png", sizeBytes: 50_000, head } : undefined)),
  } as unknown as MediaBackend;
}

/** A reactor client over the real reducers, in memory. */
export function fakeReactor() {
  const docs = new Map<string, PHDocument>();
  const reducers: Record<string, (doc: PHDocument, action: Action) => PHDocument> = {
    [renownOrganizationDocumentType]: orgReducer as never,
    [renownAppProfileDocumentType]: profileReducer as never,
  };
  const creators: Record<string, () => PHDocument> = {
    [renownOrganizationDocumentType]: () => orgUtils.createDocument() as never,
    [renownAppProfileDocumentType]: () => profileUtils.createDocument() as never,
  };
  return {
    docs,
    createEmpty: vi.fn((documentType: string) => {
      const doc = creators[documentType]();
      docs.set(doc.header.id, doc);
      return Promise.resolve(doc);
    }),
    execute: vi.fn((id: string, _branch: string, actions: Action[]) => {
      let doc = docs.get(id);
      if (!doc) return Promise.reject(new Error(`no document ${id}`));
      for (const action of actions) doc = reducers[doc.header.documentType](doc, action);
      docs.set(id, doc);
      return Promise.resolve(doc);
    }),
    get: vi.fn((id: string) => {
      const doc = docs.get(id);
      return doc ? Promise.resolve(doc) : Promise.reject(new Error(`no document ${id}`));
    }),
    /** The global state of a document. */
    state<T>(id: string): T {
      const doc = docs.get(id);
      if (!doc) throw new Error(`no document ${id}`);
      return (doc.state as unknown as { global: T }).global;
    },
  };
}

type Account = PrivateKeyAccount;
type Resolver = (parent: unknown, args: Record<string, unknown>, ctx: unknown) => Promise<unknown>;

/** Resolvers over the harness, with a settable clock and deterministic ids. */
export function harnessResolvers(h: Harness, overrides: Partial<OrgsResolverDeps> = {}) {
  const reactor = fakeReactor();
  const store = new KyselyOrgStore(h.root.withSchema(ORGS_NAMESPACE));
  const clock = { now: T0 };
  let ids = 0;
  const rt = createRuntime({
    reactorClient: reactor as unknown as OrgsResolverDeps["reactorClient"],
    relationalDb: h.relationalDb as OrgsResolverDeps["relationalDb"],
    store: () => store,
    config: () => TEST_CONFIG,
    now: () => clock.now,
    newId: () => `id-${String(++ids).padStart(4, "0")}`,
    media: () => null,
    ...overrides,
  });
  const resolvers = resolversFor(rt) as { Query: Record<string, Resolver>; Mutation: Record<string, Resolver> };
  const ctx = (who?: Account) => (who ? { user: { address: who.address } } : {});
  async function auth(field: string, args: Record<string, unknown>, who: Account, timestamp = clock.now.toISOString()): Promise<OrgAuthInput> {
    const message = await orgMessage(field, typeof args.orgId === "string" ? args.orgId : null, args, timestamp);
    return { address: who.address, signature: await who.signMessage({ message }), timestamp };
  }
  return {
    reactor,
    rt,
    store,
    clock,
    resolvers,
    /** Advances the clock by `ms`. */
    tick(ms: number) {
      clock.now = new Date(clock.now.getTime() + ms);
    },
    query: <T = unknown>(field: string, args: Record<string, unknown> = {}, who?: Account) =>
      resolvers.Query[field](null, args, ctx(who)) as Promise<T>,
    mutate: <T = unknown>(field: string, args: Record<string, unknown>, who?: Account) =>
      resolvers.Mutation[field](null, args, ctx(who)) as Promise<T>,
    auth,
    /** A mutation authorised by `who`'s signature over exactly `args` (no bearer). */
    signed: async <T = unknown>(field: string, args: Record<string, unknown>, who: Account) =>
      resolvers.Mutation[field](null, { ...args, auth: await auth(field, args, who) }, {}) as Promise<T>,
  };
}

export type TestResolvers = ReturnType<typeof harnessResolvers>;

/** createOrganization as `owner`. */
export function createOrg(t: TestResolvers, owner: Account, handle: string, extra: Record<string, unknown> = {}): Promise<OrganizationOutput> {
  return t.mutate<OrganizationOutput>("createOrganization", { handle, name: handle.toUpperCase(), ...extra }, owner);
}

/** The GraphQL error `promise` rejects with (fails the test if it resolves). */
export async function failure(promise: Promise<unknown>): Promise<{ code: unknown; field: unknown; message: string }> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(GraphQLError);
  const e = error as GraphQLError;
  return { code: e.extensions.code, field: e.extensions.field, message: e.message };
}

/** `who` joins `orgId` with `role`: invited by `by`, then accepted. Returns the member id. */
export async function join(t: TestResolvers, orgId: string, who: Account, role: string, by: Account = ALICE): Promise<string> {
  const invite = await t.mutate<{ id: string }>("inviteOrgMember", { orgId, invitee: who.address, role }, by);
  await t.mutate("respondToOrgInvite", { orgId, inviteId: invite.id, accept: true }, who);
  return invite.id;
}

/** Makes `who` an owner the way production does: ADMIN, then a single-owner ADD_OWNER proposal past the timelock. */
export async function addOwner(t: TestResolvers, orgId: string, who: Account): Promise<void> {
  const owners = (await t.store.members(orgId, ["ACTIVE"])).filter((m) => m.role === "OWNER");
  const proposer = owners.at(0);
  if (!proposer) throw new Error("addOwner needs an owner");
  if (!(await t.store.openMember(orgId, who.address.toLowerCase()))) await join(t, orgId, who, "ADMIN");
  const proposerCtx = { user: { address: proposer.address } };
  const p = (await t.resolvers.Mutation.proposeOrgChange(null, { orgId, kind: "ADD_OWNER", payload: { address: who.address } }, proposerCtx)) as { id: string };
  for (const owner of owners.slice(1, 2)) {
    await t.resolvers.Mutation.approveOrgProposal(null, { orgId, proposalId: p.id }, { user: { address: owner.address } });
  }
  t.tick(TEST_CONFIG.timelockSeconds * 1000);
  await t.resolvers.Mutation.executeOrgProposal(null, { orgId, proposalId: p.id }, proposerCtx);
}

/** A delegation credential row from `issuer` to `appDid`, as the renown-credential processor writes it. */
export async function insertCredential(
  h: Harness,
  row: { credentialId: string; issuer: string; appDid: string; revoked?: boolean; expiresAt?: Date | null; issuedAt?: Date },
): Promise<void> {
  await h.root
    .withSchema(CRED_NS)
    .insertInto("renown_credential")
    .values({
      document_id: `doc-${row.credentialId}`,
      context: "[]",
      credential_id: row.credentialId,
      type: "[]",
      issuer_id: `did:pkh:eip155:1:${row.issuer}`,
      issuer_ethereum_address: row.issuer,
      issuance_date: row.issuedAt ?? T0,
      expiration_date: row.expiresAt === undefined ? new Date("2027-10-12T00:00:00Z") : row.expiresAt,
      credential_subject_id: row.appDid,
      credential_subject_app: "test-app",
      credential_status_id: null,
      credential_status_type: null,
      credential_schema_id: "schema",
      credential_schema_type: "type",
      proof_verification_method: "method",
      proof_ethereum_address: row.issuer,
      proof_created: T0,
      proof_purpose: "assertionMethod",
      proof_type: "EthereumEip712Signature2021",
      proof_value: "0x",
      proof_eip712_domain: "{}",
      proof_eip712_primary_type: "VerifiableCredential",
      revoked: row.revoked ?? false,
      revoked_at: null,
      revocation_reason: null,
    })
    .execute();
}

/** A person-owned app profile, as renown-stats' upsertAppProfile creates it. Returns its document id. */
export async function insertAppProfile(h: Harness, t: TestResolvers, appDid: string, publisher: string): Promise<string> {
  const doc = await t.reactor.createEmpty(renownAppProfileDocumentType);
  await t.reactor.execute(doc.header.id, "main", [
    profileActions.setAppDid({ appDid }),
    profileActions.setPublisherDid({ publisherDid: pkhDidFor(publisher) }),
  ]);
  await h.root
    .withSchema(STATS_NS)
    .insertInto("app_profile_documents")
    .values({ app_did: appDid, document_id: doc.header.id, publisher_address: publisher.toLowerCase(), created_at: T0 })
    .execute();
  return doc.header.id;
}
