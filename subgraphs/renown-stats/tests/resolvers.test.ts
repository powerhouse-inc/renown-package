import { PGlite } from "@electric-sql/pglite";
import type { IRelationalDb } from "@powerhousedao/reactor-browser";
import {
  createAuthBearerToken,
  DEFAULT_RENOWN_NETWORK_ID,
  MemoryKeyStorage,
  RenownCryptoBuilder,
} from "@renown/sdk";
import { generateId, type Action, type PHDocument } from "document-model";
import { GraphQLError } from "graphql";
import { Kysely, sql } from "kysely";
import { PGliteDialect } from "kysely-pglite-dialect";
import { getAddress } from "viem";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  reducer as profileReducer,
  renownAppProfileDocumentType,
  utils as profileUtils,
} from "../../../document-models/renown-app-profile/index.js";
import {
  reducer as statsReducer,
  renownUserStatsDocumentType,
  utils as statsUtils,
} from "../../../document-models/renown-user-stats/index.js";
import { RenownCredentialProcessor } from "../../../processors/renown-credential/index.js";
import { up as upCredential } from "../../../processors/renown-credential/migrations.js";
import type { DB as CredentialDB } from "../../../processors/renown-credential/schema.js";
import { createRateLimiter } from "../../renown-auth/core/rate-limit.js";
import { migrate as migrateWorkload } from "../../renown-workload/store/migrations.js";
import type { WorkloadDB } from "../../renown-workload/store/types.js";
import { pkhDidFor } from "../core/dids.js";
import {
  APP_TOKEN_HEADER,
  createResolvers,
  type StatsResolverDeps,
} from "../resolvers.js";
import { KyselyStatsIndex } from "../store/kysely.js";
import { migrate } from "../store/migrations.js";
import type { StatsDB } from "../store/types.js";

const AUDIENCE = "https://switchboard.renown.vetra.io/graphql/renown-stats";
const OWNER = "0xabc0000000000000000000000000000000000001";
const MALLORY = "0xbad0000000000000000000000000000000000666";
const USER = `did:pkh:eip155:1:${"0x1111111111111111111111111111111111111111"}`;
const NOW = new Date("2026-10-08T10:00:00.000Z");
/** The dashboard app allowed to write profiles (RENOWN_STATS_PROFILE_APPS). */
const PROFILE_APP = "did:key:zDashboardAppDidForProfileUpsertsXXXXXXXXXXXX";
const CRED_NS = RenownCredentialProcessor.getNamespace("renown-credential");

let root: Kysely<CredentialDB & StatsDB>;
/** The renown-stats namespace, typed as the index sees it. */
const statsDb = (): Kysely<StatsDB> =>
  root.withSchema("renown-stats") as unknown as Kysely<StatsDB>;

beforeAll(async () => {
  root = new Kysely<CredentialDB & StatsDB>({
    dialect: new PGliteDialect(new PGlite()),
  });
  await sql`create schema ${sql.id(CRED_NS)}`.execute(root);
  await upCredential(root.withSchema(CRED_NS) as never);
  await sql`create schema "renown-stats"`.execute(root);
  await migrate(root.withSchema("renown-stats"));
  await sql`create schema "renown-workload"`.execute(root);
  await migrateWorkload(root.withSchema("renown-workload"));
});

afterAll(async () => {
  await root.destroy();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** renown-workload's identities, as its subgraph writes them. */
const workloadDb = (): Kysely<WorkloadDB> =>
  root.withSchema("renown-workload") as unknown as Kysely<WorkloadDB>;

let consoleWarn: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  // The SDK reports malformed tokens on console.error, and refusals after a
  // lookup failure warn; keep test output clean (asserted where it matters).
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  await workloadDb().deleteFrom("workload_identities").execute();
  await root.withSchema(CRED_NS).deleteFrom("renown_credential").execute();
  await root
    .withSchema("renown-stats")
    .deleteFrom("user_stats_documents")
    .execute();
  await root
    .withSchema("renown-stats")
    .deleteFrom("app_profile_documents")
    .execute();
});

const relationalDb = {
  queryNamespace: (namespace: string) => root.withSchema(namespace),
} as unknown as IRelationalDb<unknown>;

/** A delegation credential row from `address` to `appDid`, as the renown-credential processor writes it. */
async function insertDelegation(
  address: string,
  appDid: string,
  options: { revoked?: boolean; expiresAt?: Date | null } = {},
): Promise<void> {
  await root
    .withSchema(CRED_NS)
    .insertInto("renown_credential")
    .values({
      document_id: generateId(),
      context: "[]",
      credential_id: generateId(),
      type: "[]",
      issuer_id: `did:pkh:eip155:1:${address}`,
      issuer_ethereum_address: address,
      issuance_date: NOW,
      expiration_date:
        options.expiresAt === undefined
          ? new Date("2027-10-08T00:00:00Z")
          : options.expiresAt,
      credential_subject_id: appDid,
      credential_subject_app: "test-app",
      credential_status_id: null,
      credential_status_type: null,
      credential_schema_id: "schema",
      credential_schema_type: "type",
      proof_verification_method: "method",
      proof_ethereum_address: address,
      proof_created: NOW,
      proof_purpose: "assertionMethod",
      proof_type: "EthereumEip712Signature2021",
      proof_value: "0x",
      proof_eip712_domain: "{}",
      proof_eip712_primary_type: "VerifiableCredential",
      revoked: options.revoked ?? false,
      revoked_at: null,
      revocation_reason: null,
    })
    .execute();
}

/** Registers `did` as a server-held workload identity owned by `owner` (stored EIP-55, as the registry does). */
async function registerIdentity(did: string, owner: string): Promise<void> {
  await workloadDb()
    .insertInto("workload_identities")
    .values({
      did,
      provider: "github",
      repository_id: generateId(),
      repository: "acme/app",
      production_branch: "main",
      owner_address: getAddress(owner),
      chain_id: 1,
      encrypted_key_pair: "sealed",
      created_at: NOW,
      updated_at: NOW,
    })
    .execute();
}

/**
 * An app identity with its own did:key, acting for `owner`, registered as a
 * workload identity of `owner` unless `register` is false.
 */
async function makeApp(owner = OWNER, options: { register?: boolean } = {}) {
  const renownCrypto = await new RenownCryptoBuilder()
    .withKeyPairStorage(new MemoryKeyStorage())
    .withChainId(1)
    .build();
  if (options.register !== false)
    await registerIdentity(renownCrypto.did, owner);
  return {
    did: renownCrypto.did,
    /** A stats-audience token signed by the app key, but naming `address` as its wallet. */
    tokenAs: (address: string) =>
      createAuthBearerToken(
        1,
        DEFAULT_RENOWN_NETWORK_ID,
        address,
        renownCrypto.issuer,
        {
          aud: AUDIENCE,
          expiresIn: 600,
        },
      ),
    token: (
      options: { aud?: string; expiresIn?: number } = {
        aud: AUDIENCE,
        expiresIn: 600,
      },
    ) =>
      createAuthBearerToken(
        1,
        DEFAULT_RENOWN_NETWORK_ID,
        owner,
        renownCrypto.issuer,
        options,
      ),
  };
}

/** A reactor client over the real reducers, in memory. */
function fakeReactor() {
  const docs = new Map<string, PHDocument>();
  const reducers: Record<
    string,
    (doc: PHDocument, action: Action) => PHDocument
  > = {
    [renownUserStatsDocumentType]: statsReducer as never,
    [renownAppProfileDocumentType]: profileReducer as never,
  };
  const creators: Record<string, () => PHDocument> = {
    [renownUserStatsDocumentType]: () => statsUtils.createDocument() as never,
    [renownAppProfileDocumentType]: () =>
      profileUtils.createDocument() as never,
  };
  const createEmpty = vi.fn((documentType: string) => {
    const doc = creators[documentType]();
    docs.set(doc.header.id, doc);
    return Promise.resolve(doc);
  });
  const execute = vi.fn((id: string, _branch: string, actions: Action[]) => {
    let doc = docs.get(id);
    if (!doc) return Promise.reject(new Error(`no document ${id}`));
    for (const action of actions)
      doc = reducers[doc.header.documentType](doc, action);
    docs.set(id, doc);
    return Promise.resolve(doc);
  });
  const get = vi.fn((id: string) => {
    const doc = docs.get(id);
    return doc
      ? Promise.resolve(doc)
      : Promise.reject(new Error(`no document ${id}`));
  });
  const ofType = (type: string) =>
    [...docs.values()].filter((d) => d.header.documentType === type);
  return { createEmpty, execute, get, ofType };
}

type Ctx = {
  user?: { address?: string; appKey?: string };
  headers?: Record<string, string>;
};
type Resolver = (
  parent: unknown,
  args: Record<string, unknown>,
  ctx: Ctx,
) => Promise<unknown>;

function setup(
  options: {
    reportLimit?: number;
    withIndex?: boolean;
    reactor?: ReturnType<typeof fakeReactor>;
    profileApps?: string[];
  } = {},
) {
  const reactor = options.reactor ?? fakeReactor();
  const index = new KyselyStatsIndex(statsDb());
  const resolvers = createResolvers({
    reactorClient: reactor as unknown as StatsResolverDeps["reactorClient"],
    relationalDb,
    index: () => (options.withIndex === false ? undefined : index),
    audience: () => AUDIENCE,
    profileApps: () => new Set(options.profileApps ?? [PROFILE_APP]),
    now: () => NOW,
    ...(options.reportLimit !== undefined
      ? { reportRateLimiter: createRateLimiter(options.reportLimit, 60_000) }
      : {}),
  }) as { Query: Record<string, Resolver>; Mutation: Record<string, Resolver> };
  return {
    reactor,
    report: (args: Record<string, unknown>, ctx: Ctx) =>
      resolvers.Mutation.reportUserStat(null, args, ctx),
    upsert: (args: Record<string, unknown>, ctx: Ctx) =>
      resolvers.Mutation.upsertAppProfile(null, args, ctx),
    userStats: (userDid: string) =>
      resolvers.Query.userStats(null, { userDid }, {}),
    appProfile: (appDid: string) =>
      resolvers.Query.appProfile(null, { appDid }, {}),
    byPublisher: (publisherDid: string) =>
      resolvers.Query.appProfilesByPublisher(null, { publisherDid }, {}),
  };
}

async function code(promise: Promise<unknown>): Promise<unknown> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(GraphQLError);
  return (error as GraphQLError).extensions.code;
}

const hostBearer = (appKey: string, address = OWNER): Ctx => ({
  user: { address, appKey },
});
const appHeader = async (token: Promise<string>): Promise<Ctx> => ({
  headers: { [APP_TOKEN_HEADER]: await token },
});
/** A wallet bearer signed by the listed dashboard app (or by `appKey`). */
const wallet = (address: string, appKey = PROFILE_APP): Ctx => ({
  user: { address, appKey },
});

describe("reportUserStat", () => {
  it("accepts a host-resolved bearer issued by the app DID and reads the stat back", async () => {
    const app = await makeApp();
    await insertDelegation(OWNER, app.did);
    const { report, userStats } = setup();
    expect(
      await report(
        { appDid: app.did, userDid: USER, metric: "messagesSent", value: 3 },
        hostBearer(app.did),
      ),
    ).toBe(true);
    expect(await userStats(USER)).toEqual([
      {
        appDid: app.did,
        metric: "messagesSent",
        value: 3,
        updatedAt: NOW.toISOString(),
      },
    ]);
  });

  it("accepts an app token in X-Renown-App-Token when the owner delegated to the app", async () => {
    const app = await makeApp();
    await insertDelegation(OWNER, app.did);
    const { report, userStats } = setup();
    expect(
      await report(
        { appDid: app.did, userDid: USER, metric: "m", value: 1 },
        await appHeader(app.token()),
      ),
    ).toBe(true);
    expect(await userStats(USER)).toHaveLength(1);
  });

  it.each([
    ["no delegation", (_did: string) => Promise.resolve()],
    [
      "a revoked delegation",
      (did: string) => insertDelegation(OWNER, did, { revoked: true }),
    ],
    [
      "an expired delegation",
      (did: string) =>
        insertDelegation(OWNER, did, {
          expiresAt: new Date("2026-01-01T00:00:00Z"),
        }),
    ],
  ])("refuses an app token with %s", async (_label, delegate) => {
    const app = await makeApp();
    await delegate(app.did);
    const { report, reactor } = setup();
    expect(
      await code(
        report(
          { appDid: app.did, userDid: USER, metric: "m", value: 1 },
          await appHeader(app.token()),
        ),
      ),
    ).toBe("FORBIDDEN");
    expect(reactor.ofType(renownUserStatsDocumentType)).toHaveLength(0);
  });

  it("refuses a header token for another audience or without an audience", async () => {
    const app = await makeApp();
    await insertDelegation(OWNER, app.did);
    const { report } = setup();
    const args = { appDid: app.did, userDid: USER, metric: "m", value: 1 };
    expect(
      await code(
        report(
          args,
          await appHeader(
            app.token({ aud: "https://registry.vetra.io", expiresIn: 600 }),
          ),
        ),
      ),
    ).toBe("FORBIDDEN");
    expect(
      await code(report(args, await appHeader(app.token({ expiresIn: 600 })))),
    ).toBe("FORBIDDEN");
    expect(
      await code(
        report(args, { headers: { [APP_TOKEN_HEADER]: "not-a-jwt" } }),
      ),
    ).toBe("FORBIDDEN");
  });

  it("refuses anyone but the app: anonymous, another app, a user's own session key", async () => {
    const app = await makeApp();
    const other = await makeApp();
    const { report } = setup();
    const args = { appDid: app.did, userDid: USER, metric: "m", value: 1 };
    expect(await code(report(args, {}))).toBe("FORBIDDEN");
    expect(await code(report(args, hostBearer(other.did)))).toBe("FORBIDDEN");
    expect(await code(report(args, wallet(OWNER)))).toBe("FORBIDDEN");
  });

  it("keeps current values: duplicates are harmless, a new value replaces the old", async () => {
    const app = await makeApp();
    await insertDelegation(OWNER, app.did);
    const { report, userStats, reactor } = setup();
    const ctx = hostBearer(app.did);
    await report(
      { appDid: app.did, userDid: USER, metric: "m", value: 5 },
      ctx,
    );
    await report(
      { appDid: app.did, userDid: USER, metric: "m", value: 5 },
      ctx,
    );
    await report(
      { appDid: app.did, userDid: USER, metric: "m", value: 7 },
      ctx,
    );
    expect(await userStats(USER)).toEqual([
      { appDid: app.did, metric: "m", value: 7, updatedAt: NOW.toISOString() },
    ]);
    expect(reactor.ofType(renownUserStatsDocumentType)).toHaveLength(1);
  });

  it("appends no operation when the reported value is unchanged", async () => {
    const app = await makeApp();
    await insertDelegation(OWNER, app.did);
    const { report, reactor } = setup();
    const ctx = hostBearer(app.did);
    const send = (value: number) =>
      report({ appDid: app.did, userDid: USER, metric: "m", value }, ctx);
    await send(5);
    const [doc] = reactor.ofType(renownUserStatsDocumentType);
    const before = doc.operations.global.length;
    expect(await send(5)).toBe(true);
    expect(
      (await reactor.get(doc.header.id)).operations.global,
    ).toHaveLength(before);
    expect(await send(6)).toBe(true);
    expect(
      (await reactor.get(doc.header.id)).operations.global,
    ).toHaveLength(before + 1);
  });

  it("folds did:pkh spellings of one wallet into one document", async () => {
    const app = await makeApp();
    await insertDelegation(OWNER, app.did);
    const { report, userStats, reactor } = setup();
    const address = "0x1111111111111111111111111111111111111111";
    await report(
      {
        appDid: app.did,
        userDid: `did:pkh:eip155:137:${address}`,
        metric: "a",
        value: 1,
      },
      hostBearer(app.did),
    );
    await report(
      {
        appDid: app.did,
        userDid: `did:pkh:eip155:1:${address}`,
        metric: "b",
        value: 2,
      },
      hostBearer(app.did),
    );
    expect(reactor.ofType(renownUserStatsDocumentType)).toHaveLength(1);
    expect(await userStats(`did:pkh:eip155:10:${address}`)).toHaveLength(2);
  });

  it("creates exactly one document when first reports race", async () => {
    const app = await makeApp();
    await insertDelegation(OWNER, app.did);
    const { report, userStats, reactor } = setup();
    const ctx = hostBearer(app.did);
    await Promise.all([
      report({ appDid: app.did, userDid: USER, metric: "a", value: 1 }, ctx),
      report({ appDid: app.did, userDid: USER, metric: "b", value: 2 }, ctx),
      report({ appDid: app.did, userDid: USER, metric: "c", value: 3 }, ctx),
    ]);
    expect(reactor.ofType(renownUserStatsDocumentType)).toHaveLength(1);
    expect(await userStats(USER)).toHaveLength(3);
  });

  it("rejects malformed input with BAD_USER_INPUT", async () => {
    const app = await makeApp();
    await insertDelegation(OWNER, app.did);
    const { report } = setup();
    const ctx = hostBearer(app.did);
    expect(
      await code(
        report(
          { appDid: "did:web:x", userDid: USER, metric: "m", value: 1 },
          ctx,
        ),
      ),
    ).toBe("BAD_USER_INPUT");
    expect(
      await code(
        report(
          { appDid: app.did, userDid: "alice", metric: "m", value: 1 },
          ctx,
        ),
      ),
    ).toBe("BAD_USER_INPUT");
    expect(
      await code(
        report(
          { appDid: app.did, userDid: USER, metric: "no spaces", value: 1 },
          ctx,
        ),
      ),
    ).toBe("BAD_USER_INPUT");
    expect(
      await code(
        report(
          {
            appDid: app.did,
            userDid: USER,
            metric: "m",
            value: Number.POSITIVE_INFINITY,
          },
          ctx,
        ),
      ),
    ).toBe("BAD_USER_INPUT");
  });

  it("rate-limits per app DID", async () => {
    const app = await makeApp();
    await insertDelegation(OWNER, app.did);
    const { report } = setup({ reportLimit: 1 });
    await report(
      { appDid: app.did, userDid: USER, metric: "m", value: 1 },
      hostBearer(app.did),
    );
    expect(
      await code(
        report(
          { appDid: app.did, userDid: USER, metric: "m", value: 2 },
          hostBearer(app.did),
        ),
      ),
    ).toBe("RATE_LIMITED");
  });

  it("answers SERVICE_NOT_CONFIGURED without its index", async () => {
    const app = await makeApp();
    await insertDelegation(OWNER, app.did);
    const { report, userStats } = setup({ withIndex: false });
    expect(
      await code(
        report(
          { appDid: app.did, userDid: USER, metric: "m", value: 1 },
          hostBearer(app.did),
        ),
      ),
    ).toBe("SERVICE_NOT_CONFIGURED");
    expect(await code(userStats(USER))).toBe("SERVICE_NOT_CONFIGURED");
  });

  it("returns [] for a user nobody reported on", async () => {
    expect(await setup().userStats(USER)).toEqual([]);
  });
});

describe("upsertAppProfile", () => {
  it("lets the delegating owner create the profile and become its publisher", async () => {
    const app = await makeApp();
    await insertDelegation(OWNER, app.did);
    const { upsert, appProfile, byPublisher } = setup();
    const fields = {
      name: "Speckle",
      tagline: "3D data",
      logo: "https://cdn.example/l.png",
      website: "https://speckle.systems",
    };
    expect(await upsert({ appDid: app.did, ...fields }, wallet(OWNER))).toBe(
      true,
    );
    const expected = {
      appDid: app.did,
      publisherDid: pkhDidFor(OWNER),
      ...fields,
    };
    expect(await appProfile(app.did)).toEqual(expected);
    expect(await byPublisher(`did:pkh:eip155:137:${OWNER}`)).toEqual([
      expected,
    ]);
    expect(await byPublisher(OWNER.toUpperCase().replace("0X", "0x"))).toEqual([
      expected,
    ]);
  });

  it("lets the publisher patch and clear fields later", async () => {
    const app = await makeApp();
    await insertDelegation(OWNER, app.did);
    const { upsert, appProfile } = setup();
    await upsert(
      { appDid: app.did, name: "Speckle", tagline: "3D" },
      wallet(OWNER),
    );
    await upsert(
      { appDid: app.did, tagline: "", website: "https://speckle.systems" },
      wallet(OWNER),
    );
    expect(await appProfile(app.did)).toMatchObject({
      name: "Speckle",
      tagline: null,
      website: "https://speckle.systems",
    });
  });

  it("refuses anonymous callers and a first upsert without a delegation", async () => {
    const app = await makeApp();
    const { upsert, reactor } = setup();
    expect(await code(upsert({ appDid: app.did, name: "x" }, {}))).toBe(
      "FORBIDDEN",
    );
    expect(
      await code(upsert({ appDid: app.did, name: "squat" }, wallet(MALLORY))),
    ).toBe("FORBIDDEN");
    expect(reactor.ofType(renownAppProfileDocumentType)).toHaveLength(0);
  });

  it("refuses anyone but the publisher once the profile exists, even with a delegation", async () => {
    const app = await makeApp();
    await insertDelegation(OWNER, app.did);
    await insertDelegation(MALLORY, app.did);
    const { upsert, appProfile } = setup();
    await upsert({ appDid: app.did, name: "Speckle" }, wallet(OWNER));
    expect(
      await code(
        upsert({ appDid: app.did, name: "Hijacked" }, wallet(MALLORY)),
      ),
    ).toBe("FORBIDDEN");
    expect(await appProfile(app.did)).toMatchObject({
      name: "Speckle",
      publisherDid: pkhDidFor(OWNER),
    });
  });

  it("rejects bad input before creating anything", async () => {
    const app = await makeApp();
    await insertDelegation(OWNER, app.did);
    const { upsert, reactor } = setup();
    expect(
      await code(
        upsert(
          { appDid: app.did, website: "javascript:alert(1)" },
          wallet(OWNER),
        ),
      ),
    ).toBe("BAD_USER_INPUT");
    expect(
      await code(
        upsert({ appDid: app.did, logo: "http://x/l.png" }, wallet(OWNER)),
      ),
    ).toBe("BAD_USER_INPUT");
    expect(
      await code(
        upsert({ appDid: app.did, name: "x".repeat(121) }, wallet(OWNER)),
      ),
    ).toBe("BAD_USER_INPUT");
    expect(
      await code(upsert({ appDid: "did:web:x", name: "x" }, wallet(OWNER))),
    ).toBe("BAD_USER_INPUT");
    expect(reactor.ofType(renownAppProfileDocumentType)).toHaveLength(0);
  });

  it("refuses a bearer from an app not in RENOWN_STATS_PROFILE_APPS, even the owner's; accepts a listed one", async () => {
    const app = await makeApp();
    const thirdParty = await makeApp(MALLORY);
    await insertDelegation(OWNER, app.did);
    const { upsert, appProfile, reactor } = setup();
    expect(
      await code(
        upsert({ appDid: app.did, name: "x" }, wallet(OWNER, thirdParty.did)),
      ),
    ).toBe("FORBIDDEN");
    // The app's own key is no profile app either.
    expect(
      await code(upsert({ appDid: app.did, name: "x" }, wallet(OWNER, app.did))),
    ).toBe("FORBIDDEN");
    expect(
      await code(upsert({ appDid: app.did, name: "x" }, { user: { address: OWNER } })),
    ).toBe("FORBIDDEN");
    expect(reactor.ofType(renownAppProfileDocumentType)).toHaveLength(0);
    expect(await upsert({ appDid: app.did, name: "Speckle" }, wallet(OWNER))).toBe(
      true,
    );
    // Once claimed, a non-listed app still cannot rewrite it (e.g. a phishing website).
    expect(
      await code(
        upsert(
          { appDid: app.did, website: "https://phish.example" },
          wallet(OWNER, thirdParty.did),
        ),
      ),
    ).toBe("FORBIDDEN");
    expect(await appProfile(app.did)).toMatchObject({
      name: "Speckle",
      website: null,
    });
  });

  it("refuses every upsert when no profile app is configured", async () => {
    const app = await makeApp();
    await insertDelegation(OWNER, app.did);
    const { upsert, reactor } = setup({ profileApps: [] });
    expect(
      await code(upsert({ appDid: app.did, name: "x" }, wallet(OWNER))),
    ).toBe("FORBIDDEN");
    expect(reactor.ofType(renownAppProfileDocumentType)).toHaveLength(0);
  });

  it("returns null for an unknown app and rejects a non-wallet publisher query", async () => {
    const app = await makeApp();
    const { appProfile, byPublisher } = setup();
    expect(await appProfile(app.did)).toBeNull();
    expect(await code(byPublisher(app.did))).toBe("BAD_USER_INPUT");
  });
});

describe("authorisation hardening", () => {
  const args = (did: string) => ({
    appDid: did,
    userDid: USER,
    metric: "m",
    value: 1,
  });

  it("never falls back to the host bearer when the app-token header is present but invalid", async () => {
    const app = await makeApp();
    await insertDelegation(OWNER, app.did);
    const { report, reactor } = setup();
    const withBoth = (header: string): Ctx => ({
      ...hostBearer(app.did),
      headers: { [APP_TOKEN_HEADER]: header },
    });
    expect(await code(report(args(app.did), withBoth("not-a-jwt")))).toBe(
      "FORBIDDEN",
    );
    expect(await code(report(args(app.did), withBoth("")))).toBe("FORBIDDEN");
    expect(
      await code(
        report(
          args(app.did),
          withBoth(
            await app.token({
              aud: "https://registry.vetra.io",
              expiresIn: 600,
            }),
          ),
        ),
      ),
    ).toBe("FORBIDDEN");
    const asArray = {
      ...hostBearer(app.did),
      headers: { [APP_TOKEN_HEADER]: [await app.token()] },
    } as unknown as Ctx;
    expect(await code(report(args(app.did), asArray))).toBe("FORBIDDEN");
    expect(reactor.ofType(renownUserStatsDocumentType)).toHaveLength(0);
  });

  it("refuses a valid, delegated app token used to report as another app DID", async () => {
    const app = await makeApp();
    const victim = await makeApp();
    await insertDelegation(OWNER, app.did);
    await insertDelegation(OWNER, victim.did);
    const { report } = setup();
    expect(
      await code(report(args(victim.did), await appHeader(app.token()))),
    ).toBe("FORBIDDEN");
  });

  it("refuses a CI workload token (vetra claim) in the header, even with the stats audience", async () => {
    const { generateWorkloadKey, issueWorkloadToken } =
      await import("../../renown-workload/core/keys.js");
    const { did, keyPair } = await generateWorkloadKey();
    await registerIdentity(did, OWNER);
    await insertDelegation(OWNER, did);
    const { report, reactor } = setup();
    const token = await issueWorkloadToken({
      keyPair,
      did,
      chainId: 1,
      address: OWNER,
      audience: AUDIENCE,
      expiresInSec: 600,
      vetra: {
        ref: "refs/heads/main",
        refClass: "PRODUCTION",
        sha: null,
        repository: "acme/app",
        repositoryId: "1",
        runId: null,
        runAttempt: null,
        actor: null,
        prNumber: null,
        eventName: "push",
        workflowRef: null,
      },
    });
    expect(
      await code(report(args(did), await appHeader(Promise.resolve(token)))),
    ).toBe("FORBIDDEN");
    expect(reactor.ofType(renownUserStatsDocumentType)).toHaveLength(0);
  });

  it("refuses a header token whose delegation came from a different wallet than its subject", async () => {
    const app = await makeApp(OWNER);
    await insertDelegation(MALLORY, app.did);
    const { report } = setup();
    expect(
      await code(report(args(app.did), await appHeader(app.token()))),
    ).toBe("FORBIDDEN");
  });

  it("accepts a header token when the delegation row stores a checksummed address", async () => {
    const app = await makeApp();
    await insertDelegation(getAddress(OWNER), app.did);
    const { report } = setup();
    expect(await report(args(app.did), await appHeader(app.token()))).toBe(
      true,
    );
  });

  it("gives FORBIDDEN errors one message whatever check failed", async () => {
    const app = await makeApp();
    const other = await makeApp();
    const { report, upsert } = setup();
    const errors = await Promise.all([
      report(args(app.did), {}).catch((e: unknown) => e),
      report(args(app.did), hostBearer(other.did)).catch((e: unknown) => e),
      report(args(app.did), { headers: { [APP_TOKEN_HEADER]: "x" } }).catch(
        (e: unknown) => e,
      ),
      upsert({ appDid: app.did, name: "x" }, {}).catch((e: unknown) => e),
      upsert({ appDid: app.did, name: "x" }, wallet(MALLORY)).catch(
        (e: unknown) => e,
      ),
    ]);
    expect(new Set(errors.map((e) => (e as GraphQLError).message))).toEqual(
      new Set(["Forbidden"]),
    );
  });

  it("stores publisherDid canonically and matches publishers by lowercase address, whatever the casing", async () => {
    const app = await makeApp();
    await insertDelegation(getAddress(OWNER), app.did);
    const { upsert, appProfile, byPublisher } = setup();
    // The host hands over a checksummed (mixed-case) address.
    expect(
      await upsert(
        { appDid: app.did, name: "Speckle" },
        wallet(getAddress(OWNER)),
      ),
    ).toBe(true);
    const canonical = `did:pkh:eip155:1:${getAddress(OWNER)}`;
    expect(await appProfile(app.did)).toMatchObject({
      publisherDid: canonical,
    });
    const rows = await root
      .withSchema("renown-stats")
      .selectFrom("app_profile_documents")
      .selectAll()
      .execute();
    expect(rows.map((row) => row.publisher_address)).toEqual([
      OWNER.toLowerCase(),
    ]);
    // A later upsert in another casing is still the publisher.
    expect(
      await upsert(
        { appDid: app.did, tagline: "3D" },
        wallet(OWNER.toUpperCase().replace("0X", "0x")),
      ),
    ).toBe(true);
    for (const query of [
      canonical,
      getAddress(OWNER),
      OWNER,
      `did:pkh:eip155:137:${OWNER.toUpperCase().replace("0X", "0x")}`,
    ]) {
      expect(await byPublisher(query)).toEqual([
        expect.objectContaining({ appDid: app.did, tagline: "3D" }),
      ]);
    }
    // Another wallet in any casing is still refused.
    expect(
      await code(
        upsert(
          { appDid: app.did, name: "Hijacked" },
          wallet(getAddress(MALLORY)),
        ),
      ),
    ).toBe("FORBIDDEN");
  });

  it("lets only one of several concurrent first upserts claim the profile", async () => {
    const app = await makeApp();
    await insertDelegation(OWNER, app.did);
    const { upsert, reactor, appProfile } = setup();
    await Promise.all([
      upsert({ appDid: app.did, name: "a" }, wallet(OWNER)),
      upsert({ appDid: app.did, tagline: "b" }, wallet(OWNER)),
      upsert({ appDid: app.did, website: "https://c.example" }, wallet(OWNER)),
    ]);
    expect(reactor.ofType(renownAppProfileDocumentType)).toHaveLength(1);
    expect(await appProfile(app.did)).toMatchObject({
      name: "a",
      tagline: "b",
      website: "https://c.example",
    });
  });

  it("creates exactly one user-stats document for a burst of first reports, every value landing in it", async () => {
    const app = await makeApp();
    await insertDelegation(OWNER, app.did);
    const { report, reactor, userStats } = setup();
    const ctx = hostBearer(app.did);
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        report(
          { appDid: app.did, userDid: USER, metric: `m${i}`, value: i },
          ctx,
        ),
      ),
    );
    expect(reactor.ofType(renownUserStatsDocumentType)).toHaveLength(1);
    expect(reactor.createEmpty).toHaveBeenCalledTimes(1);
    expect(await userStats(USER)).toHaveLength(10);
  });

  it("routes every report to the indexed document even across resolver instances that race", async () => {
    const app = await makeApp();
    await insertDelegation(OWNER, app.did);
    const reactor = fakeReactor();
    const a = setup({ reactor });
    const b = setup({ reactor });
    const ctx = hostBearer(app.did);
    await Promise.all([
      a.report({ appDid: app.did, userDid: USER, metric: "x", value: 1 }, ctx),
      b.report({ appDid: app.did, userDid: USER, metric: "y", value: 2 }, ctx),
    ]);
    expect(await a.userStats(USER)).toHaveLength(2);
  });

  it("rate-limits profile upserts per wallet", async () => {
    const app = await makeApp();
    await insertDelegation(OWNER, app.did);
    const resolvers = createResolvers({
      reactorClient:
        fakeReactor() as unknown as StatsResolverDeps["reactorClient"],
      relationalDb,
      index: () => new KyselyStatsIndex(statsDb()),
      audience: () => AUDIENCE,
      profileApps: () => new Set([PROFILE_APP]),
      now: () => NOW,
      profileRateLimiter: createRateLimiter(1, 60_000),
    }) as { Mutation: Record<string, Resolver> };
    await resolvers.Mutation.upsertAppProfile(
      null,
      { appDid: app.did, name: "a" },
      wallet(OWNER),
    );
    expect(
      await code(
        resolvers.Mutation.upsertAppProfile(
          null,
          { appDid: app.did, name: "b" },
          wallet(OWNER),
        ),
      ),
    ).toBe("RATE_LIMITED");
  });

  it("answers SERVICE_NOT_CONFIGURED for profiles without its index", async () => {
    const app = await makeApp();
    const { upsert, appProfile, byPublisher } = setup({ withIndex: false });
    expect(
      await code(upsert({ appDid: app.did, name: "x" }, wallet(OWNER))),
    ).toBe("SERVICE_NOT_CONFIGURED");
    expect(await code(appProfile(app.did))).toBe("SERVICE_NOT_CONFIGURED");
    expect(await code(byPublisher(OWNER))).toBe("SERVICE_NOT_CONFIGURED");
  });

  it("rejects malformed query arguments", async () => {
    const { userStats, appProfile } = setup();
    expect(await code(userStats("alice"))).toBe("BAD_USER_INPUT");
    expect(
      await code(
        appProfile(
          "did:pkh:eip155:1:0x1111111111111111111111111111111111111111",
        ),
      ),
    ).toBe("BAD_USER_INPUT");
  });

  it("surfaces a reducer rejection (too many metrics) as BAD_USER_INPUT", async () => {
    const app = await makeApp();
    await insertDelegation(OWNER, app.did);
    const { report, userStats } = setup();
    const ctx = hostBearer(app.did);
    for (let i = 0; i < 32; i++)
      await report(
        { appDid: app.did, userDid: USER, metric: `m${i}`, value: i },
        ctx,
      );
    expect(
      await code(
        report(
          { appDid: app.did, userDid: USER, metric: "one-too-many", value: 1 },
          ctx,
        ),
      ),
    ).toBe("BAD_USER_INPUT");
    expect(await userStats(USER)).toHaveLength(32);
  });
});

describe("ownership is anchored on the registered workload identity", () => {
  const args = (did: string) => ({
    appDid: did,
    userDid: USER,
    metric: "m",
    value: 1,
  });

  it("refuses a squatter who self-delegated to the app DID; the real owner then claims it", async () => {
    const app = await makeApp(OWNER);
    await insertDelegation(MALLORY, app.did);
    const { upsert, appProfile, reactor } = setup();
    expect(
      await code(
        upsert({ appDid: app.did, name: "Squatted" }, wallet(MALLORY)),
      ),
    ).toBe("FORBIDDEN");
    expect(reactor.ofType(renownAppProfileDocumentType)).toHaveLength(0);
    expect(
      await upsert({ appDid: app.did, name: "Speckle" }, wallet(OWNER)),
    ).toBe(true);
    expect(await appProfile(app.did)).toMatchObject({
      name: "Speckle",
      publisherDid: pkhDidFor(OWNER),
    });
  });

  it("refuses to create a profile for an unregistered app DID, even for a delegating wallet", async () => {
    const app = await makeApp(OWNER, { register: false });
    await insertDelegation(OWNER, app.did);
    const { upsert, reactor } = setup();
    expect(
      await code(upsert({ appDid: app.did, name: "x" }, wallet(OWNER))),
    ).toBe("FORBIDDEN");
    expect(reactor.ofType(renownAppProfileDocumentType)).toHaveLength(0);
  });

  it("refuses an app token naming a throwaway wallet with a fresh self-delegation; accepts the owner's", async () => {
    const app = await makeApp(OWNER);
    await insertDelegation(MALLORY, app.did);
    const { report, reactor } = setup();
    expect(
      await code(report(args(app.did), await appHeader(app.tokenAs(MALLORY)))),
    ).toBe("FORBIDDEN");
    expect(reactor.ofType(renownUserStatsDocumentType)).toHaveLength(0);
    await insertDelegation(OWNER, app.did);
    expect(
      await report(args(app.did), await appHeader(app.tokenAs(OWNER))),
    ).toBe(true);
  });

  it("refuses a host bearer whose wallet is not the identity's owner, even with a delegation", async () => {
    const app = await makeApp(OWNER);
    await insertDelegation(MALLORY, app.did);
    const { report } = setup();
    expect(
      await code(report(args(app.did), hostBearer(app.did, MALLORY))),
    ).toBe("FORBIDDEN");
  });

  it("refuses an unregistered app DID on both paths, even with the owner's delegation", async () => {
    const app = await makeApp(OWNER, { register: false });
    await insertDelegation(OWNER, app.did);
    const { report, reactor } = setup();
    expect(
      await code(report(args(app.did), await appHeader(app.token()))),
    ).toBe("FORBIDDEN");
    expect(await code(report(args(app.did), hostBearer(app.did)))).toBe(
      "FORBIDDEN",
    );
    expect(reactor.ofType(renownUserStatsDocumentType)).toHaveLength(0);
  });

  it("still requires a live delegation from the owner on the host path", async () => {
    const app = await makeApp(OWNER);
    const { report } = setup();
    expect(await code(report(args(app.did), hostBearer(app.did)))).toBe(
      "FORBIDDEN",
    );
    await insertDelegation(OWNER, app.did, { revoked: true });
    expect(await code(report(args(app.did), hostBearer(app.did)))).toBe(
      "FORBIDDEN",
    );
  });

  it("matches the owner whatever casing the registry and caller use", async () => {
    const app = await makeApp(OWNER);
    await insertDelegation(OWNER, app.did);
    const { report, upsert } = setup();
    expect(
      await report(args(app.did), hostBearer(app.did, getAddress(OWNER))),
    ).toBe(true);
    expect(
      await upsert(
        { appDid: app.did, name: "x" },
        wallet(OWNER.toUpperCase().replace("0X", "0x")),
      ),
    ).toBe(true);
  });

  it("fails closed with the usual FORBIDDEN, and warns server-side, when the identity lookup fails", async () => {
    const app = await makeApp(OWNER);
    await insertDelegation(OWNER, app.did);
    const brokenDb = {
      queryNamespace: (namespace: string) => {
        if (namespace === "renown-workload")
          throw new Error("namespace unavailable");
        return root.withSchema(namespace);
      },
    } as unknown as IRelationalDb<unknown>;
    const resolvers = createResolvers({
      reactorClient:
        fakeReactor() as unknown as StatsResolverDeps["reactorClient"],
      relationalDb: brokenDb,
      index: () => new KyselyStatsIndex(statsDb()),
      audience: () => AUDIENCE,
      profileApps: () => new Set([PROFILE_APP]),
      now: () => NOW,
    }) as { Mutation: Record<string, Resolver> };
    const reportError = await resolvers.Mutation.reportUserStat(
      null,
      args(app.did),
      hostBearer(app.did),
    ).catch((e: unknown) => e);
    const upsertError = await resolvers.Mutation.upsertAppProfile(
      null,
      { appDid: app.did, name: "x" },
      wallet(OWNER),
    ).catch((e: unknown) => e);
    for (const error of [reportError, upsertError]) {
      expect(error).toBeInstanceOf(GraphQLError);
      expect((error as GraphQLError).extensions.code).toBe("FORBIDDEN");
      expect((error as GraphQLError).message).toBe("Forbidden");
    }
    expect(consoleWarn).toHaveBeenCalledWith(
      expect.stringContaining("namespace unavailable"),
    );
  });
});

describe("tokens minted by renown-workload's issueAppStatsToken", () => {
  const REGISTRATION = "registration-token";

  /** renown-workload's resolvers over the same database renown-stats reads. */
  async function workload() {
    const {
      createResolvers: createWorkloadResolvers,
      REGISTRATION_TOKEN_HEADER,
    } = await import("../../renown-workload/resolvers.js");
    const { KyselyWorkloadStore } =
      await import("../../renown-workload/store/kysely.js");
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const resolvers = createWorkloadResolvers({
      config: () => ({
        encryptionKey: new Uint8Array(32).fill(7),
        registrationToken: REGISTRATION,
        audiences: [],
      }),
      store: () => new KyselyWorkloadStore(workloadDb()),
      statsAudience: () => AUDIENCE,
    }) as { Mutation: Record<string, Resolver> };
    const ctx = {
      headers: { [REGISTRATION_TOKEN_HEADER]: REGISTRATION },
    } as unknown as Ctx;
    return {
      register: async (repositoryId: string, owner = OWNER) =>
        (
          (await resolvers.Mutation.registerWorkloadIdentity(
            null,
            {
              input: {
                repositoryId,
                repository: `acme/${repositoryId}`,
                productionBranch: "main",
                ownerAddress: owner,
                chainId: 1,
              },
            },
            ctx,
          )) as { did: string }
        ).did,
      issue: async (did: string) =>
        (
          (await resolvers.Mutation.issueAppStatsToken(null, { did }, ctx)) as {
            accessToken: string;
          }
        ).accessToken,
    };
  }

  const args = (appDid: string) => ({
    appDid,
    userDid: USER,
    metric: "m",
    value: 1,
  });

  it("are accepted by reportUserStat for their own app", async () => {
    const { register, issue } = await workload();
    const did = await register("101");
    await insertDelegation(OWNER, did);
    const { report, userStats } = setup();
    expect(await report(args(did), await appHeader(issue(did)))).toBe(true);
    expect(await userStats(USER)).toEqual([
      { appDid: did, metric: "m", value: 1, updatedAt: NOW.toISOString() },
    ]);
  });

  it("cannot report for another app, even one with the same owner", async () => {
    const { register, issue } = await workload();
    const a = await register("101");
    const b = await register("102");
    await insertDelegation(OWNER, a);
    await insertDelegation(OWNER, b);
    const { report, userStats } = setup();
    const tokenA = issue(a);
    expect(await code(report(args(b), await appHeader(tokenA)))).toBe(
      "FORBIDDEN",
    );
    expect(await userStats(USER)).toEqual([]);
  });

  it("are refused once the owner's delegation is gone", async () => {
    const { register, issue } = await workload();
    const did = await register("101");
    await insertDelegation(OWNER, did, { revoked: true });
    const { report } = setup();
    expect(await code(report(args(did), await appHeader(issue(did))))).toBe(
      "FORBIDDEN",
    );
  });

  it("are refused once the workload identity is deleted", async () => {
    const { register, issue } = await workload();
    const did = await register("101");
    await insertDelegation(OWNER, did);
    const token = await issue(did);
    await workloadDb().deleteFrom("workload_identities").execute();
    const { report } = setup();
    expect(
      await code(report(args(did), await appHeader(Promise.resolve(token)))),
    ).toBe("FORBIDDEN");
  });
});
