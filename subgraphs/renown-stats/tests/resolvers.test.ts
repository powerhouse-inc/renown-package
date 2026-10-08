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
});

afterAll(async () => {
  await root.destroy();
});

beforeEach(async () => {
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

/** An app identity with its own did:key, acting for `owner`. */
async function makeApp(owner = OWNER) {
  const renownCrypto = await new RenownCryptoBuilder()
    .withKeyPairStorage(new MemoryKeyStorage())
    .withChainId(1)
    .build();
  return {
    did: renownCrypto.did,
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
  } = {},
) {
  const reactor = options.reactor ?? fakeReactor();
  const index = new KyselyStatsIndex(statsDb());
  const resolvers = createResolvers({
    reactorClient: reactor as unknown as StatsResolverDeps["reactorClient"],
    relationalDb,
    index: () => (options.withIndex === false ? undefined : index),
    audience: () => AUDIENCE,
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
const wallet = (address: string): Ctx => ({ user: { address } });

describe("reportUserStat", () => {
  it("accepts a host-resolved bearer issued by the app DID and reads the stat back", async () => {
    const app = await makeApp();
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

  it("folds did:pkh spellings of one wallet into one document", async () => {
    const app = await makeApp();
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
