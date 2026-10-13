import type { IRelationalDb } from "@powerhousedao/reactor-browser";
import { generateId, type Action, type PHDocument } from "document-model";
import { GraphQLError } from "graphql";
import type { Kysely } from "kysely";
import { createRelationalDb } from "@powerhousedao/shared/processors";
import { bootNamespace, hashedRoot, openPglite } from "./host-namespace.js";
import { getAddress } from "viem";
import { expect, vi } from "vitest";
import {
  reducer as profileReducer,
  renownAppProfileDocumentType,
  utils as profileUtils,
} from "../../../document-models/renown-app-profile/index.js";
import {
  actions as orgActions,
  reducer as orgReducer,
  renownOrganizationDocumentType,
  utils as orgUtils,
} from "../../../document-models/renown-organization/index.js";
import {
  reducer as statsReducer,
  renownUserStatsDocumentType,
  utils as statsUtils,
} from "../../../document-models/renown-user-stats/index.js";
import { RenownCredentialProcessor } from "../../../processors/renown-credential/index.js";
import { up as upCredential } from "../../../processors/renown-credential/migrations.js";
import { RenownUserProcessor } from "../../../processors/renown-user/index.js";
import { up as upUser } from "../../../processors/renown-user/migrations.js";
import { migrate as migrateWorkload } from "../../renown-workload/store/migrations.js";
import { REGISTRAR_HEADER } from "../core/config.js";
import { createResolvers, type StatsResolverDeps } from "../resolvers.js";
import { KyselyStatsIndex } from "../store/kysely.js";
import { migrate } from "../store/migrations.js";

// Shared by the Phase 3 suites: one PGlite with every namespace renown-stats
// reads (its own, renown-workload, the credential and user read models).

export const OWNER = "0xabc0000000000000000000000000000000000001";
/** RENOWN_WORKLOAD_REGISTRATION_TOKEN as the Vetra relay sends it. */
export const TOKEN = "registration-token-for-tests";
/** What a browser bearer carries as appKey: a random per-browser did:key. */
export const BROWSER_KEY = "did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH";
export const CRED_NS = RenownCredentialProcessor.getNamespace("renown-credential");
export const USER_NS = RenownUserProcessor.getNamespace("renown-user");
export const STATS_NS = "renown-stats";
export const WORKLOAD_NS = "renown-workload";
const T0 = new Date("2026-10-01T00:00:00Z");

export interface Harness {
  root: Kysely<any>;
  relationalDb: IRelationalDb<unknown>;
}

/**
 * Every namespace renown-stats touches, opened through the host's real
 * `createRelationalDb` (hashed schema names) and migrated on two boots;
 * `root.withSchema(name)` resolves the same hashed schema for fixtures.
 */
export async function openHarness(): Promise<Harness> {
  const raw = openPglite();
  await bootNamespace(raw, CRED_NS, (db) => upCredential(db as never));
  await bootNamespace(raw, USER_NS, (db) => upUser(db as never));
  await bootNamespace(raw, STATS_NS, migrate);
  await bootNamespace(raw, WORKLOAD_NS, migrateWorkload);
  // Writes to another namespace go through createNamespace, as on the host.
  const relationalDb = createRelationalDb(raw as never) as unknown as IRelationalDb<unknown>;
  return { root: hashedRoot(raw), relationalDb };
}

export async function resetHarness(h: Harness): Promise<void> {
  for (const table of [
    "user_stats_documents",
    "app_profile_documents",
    "app_profile_images",
    "app_metric_values",
    "renown_stats_jobs",
  ]) {
    await h.root.withSchema(STATS_NS).deleteFrom(table).execute();
  }
  await h.root.withSchema(WORKLOAD_NS).deleteFrom("workload_identities").execute();
  await h.root.withSchema(CRED_NS).deleteFrom("renown_credential").execute();
  await h.root.withSchema(USER_NS).deleteFrom("renown_user").execute();
}

/** `appDid` as a workload identity of `owner`, who holds a live delegation to it: it may report. */
export async function registerApp(h: Harness, appDid: string, owner = OWNER): Promise<void> {
  await h.root
    .withSchema(WORKLOAD_NS)
    .insertInto("workload_identities")
    .values({
      did: appDid,
      provider: "github",
      repository_id: generateId(),
      repository: "acme/app",
      production_branch: "main",
      owner_address: getAddress(owner),
      chain_id: 1,
      encrypted_key_pair: "sealed",
      created_at: T0,
      updated_at: T0,
    })
    .execute();
  await h.root
    .withSchema(CRED_NS)
    .insertInto("renown_credential")
    .values({
      document_id: generateId(),
      context: "[]",
      credential_id: generateId(),
      type: "[]",
      issuer_id: `did:pkh:eip155:1:${owner}`,
      issuer_ethereum_address: owner,
      issuance_date: T0,
      expiration_date: new Date("2027-10-01T00:00:00Z"),
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
    })
    .execute();
}

/** A Renown profile row, as the Phase 1 renown-user processor writes it. */
export async function insertProfile(
  h: Harness,
  row: {
    address: string;
    documentId: string;
    handle?: string | null;
    displayName?: string | null;
    avatarRef?: string | null;
    userImage?: string | null;
  },
): Promise<void> {
  await h.root
    .withSchema(USER_NS)
    .insertInto("renown_user")
    .values({
      document_id: row.documentId,
      eth_address: row.address,
      username: null,
      user_image: row.userImage ?? null,
      display_name: row.displayName ?? null,
      handle: row.handle ?? null,
      bio: null,
      links: "[]",
      avatar_ref: row.avatarRef ?? null,
      created_at: T0,
      updated_at: T0,
    })
    .execute();
}

/** A reactor client over the real reducers, in memory. */
export function fakeReactor() {
  const docs = new Map<string, PHDocument>();
  const reducers: Record<string, (doc: PHDocument, action: Action) => PHDocument> = {
    [renownUserStatsDocumentType]: statsReducer as never,
    [renownAppProfileDocumentType]: profileReducer as never,
    [renownOrganizationDocumentType]: orgReducer as never,
  };
  const creators: Record<string, () => PHDocument> = {
    [renownUserStatsDocumentType]: () => statsUtils.createDocument() as never,
    [renownAppProfileDocumentType]: () => profileUtils.createDocument() as never,
    [renownOrganizationDocumentType]: () => orgUtils.createDocument() as never,
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
    /** An organisation document with id `orgId`, initialised as createOrganization does. */
    seedOrganization(orgId: string, handle: string, createdBy = OWNER): void {
      const doc = orgUtils.createDocument() as unknown as PHDocument;
      docs.set(orgId, { ...doc, header: { ...doc.header, id: orgId } });
      const init = orgActions.initOrganization({ handle, name: handle, createdBy });
      docs.set(orgId, orgReducer(docs.get(orgId) as never, init) as unknown as PHDocument);
    },
    get: vi.fn((id: string) => {
      const doc = docs.get(id);
      return doc ? Promise.resolve(doc) : Promise.reject(new Error(`no document ${id}`));
    }),
  };
}

export type Ctx = {
  user?: { address?: string; appKey?: string };
  headers?: Record<string, string>;
};
type Resolver = (parent: unknown, args: Record<string, unknown>, ctx: Ctx) => Promise<unknown>;

/** The Vetra relay: the wallet's own browser bearer plus the registration token. */
export const relayed = (address = OWNER): Ctx => ({
  user: { address, appKey: BROWSER_KEY },
  headers: { [REGISTRAR_HEADER]: TOKEN },
});

/** What renownNetworkStats answers. */
export interface NetworkStatsOut {
  identities: number;
  apps: number;
  activeCredentials: number;
  activeUsers30d: number;
  updatedAt: string;
}

/** Resolvers over the harness. `now` defaults to a clock that ticks one second per call. */
export function harnessResolvers(
  h: Harness,
  options: { now?: () => Date; relationalDb?: IRelationalDb<unknown>; orgPolicy?: StatsResolverDeps["orgPolicy"] } = {},
) {
  const reactor = fakeReactor();
  const index = new KyselyStatsIndex(h.root.withSchema(STATS_NS));
  let tick = 0;
  const resolvers = createResolvers({
    reactorClient: reactor as unknown as StatsResolverDeps["reactorClient"],
    relationalDb: (options.relationalDb ?? h.relationalDb) as StatsResolverDeps["relationalDb"],
    index: () => index,
    audience: () => "https://stats.example/graphql/renown-stats",
    profileApps: () => new Set<string>(),
    registrationToken: () => TOKEN,
    media: () => null,
    now: options.now ?? (() => new Date(Date.UTC(2026, 9, 9, 12, 0, tick++))),
    orgPolicy: options.orgPolicy,
  }) as { Query: Record<string, Resolver>; Mutation: Record<string, Resolver> };
  return {
    reactor,
    index,
    resolvers,
    /** reportUserStat as the app itself (a host bearer signed by the app DID, for its owner). */
    report: (args: { appDid: string; userDid: string; metric: string; value: number }) =>
      resolvers.Mutation.reportUserStat(null, args, { user: { address: OWNER, appKey: args.appDid } }),
    upsert: (args: Record<string, unknown>, ctx: Ctx = relayed()) =>
      resolvers.Mutation.upsertAppProfile(null, args, ctx),
    appProfile: (appDid: string) => resolvers.Query.appProfile(null, { appDid }, {}),
    appStats: (appDid: string) => resolvers.Query.appStats(null, { appDid }, {}),
    userStats: (userDid: string) => resolvers.Query.userStats(null, { userDid }, {}),
    appProfiles: (args: { limit?: number | null; after?: string | null; category?: string | null; orgId?: string | null }) =>
      resolvers.Query.appProfiles(null, args, {}) as Promise<{ items: { appDid: string; category: string | null }[]; next: string | null }>,
    appProfileCategories: () =>
      resolvers.Query.appProfileCategories(null, {}, {}) as Promise<{ category: string; count: number }[]>,
    networkStats: () => resolvers.Query.renownNetworkStats(null, {}, {}) as Promise<NetworkStatsOut>,
  };
}

/** The GraphQL error `promise` rejects with (fails the test if it resolves). */
export async function failure(
  promise: Promise<unknown>,
): Promise<{ code: unknown; field: unknown; message: string }> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(GraphQLError);
  const e = error as GraphQLError;
  return { code: e.extensions.code, field: e.extensions.field, message: e.message };
}
