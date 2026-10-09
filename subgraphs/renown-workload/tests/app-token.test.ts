import { verifyAuthBearerToken } from "@renown/sdk";
import { GraphQLError } from "graphql";
import { getAddress } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seal } from "../core/crypto.js";
import { generateWorkloadKey, issueAppToken } from "../core/keys.js";
import type { WorkloadConfig } from "../core/types.js";
import {
  APP_STATS_TOKEN_TTL_SEC,
  createResolvers,
  REGISTRATION_TOKEN_HEADER,
} from "../resolvers.js";
import { MemoryWorkloadStore } from "../store/memory.js";

type Resolver = (
  parent: unknown,
  args: unknown,
  ctx: unknown,
) => Promise<unknown>;

const STATS_AUDIENCE = "https://sb.example/graphql/renown-stats";
const OWNER = "0xabcdef0123456789abcdef0123456789abcdef01";
const authorized = { headers: { [REGISTRATION_TOKEN_HEADER]: "right-token" } };

let config: WorkloadConfig;
let store: MemoryWorkloadStore;

function mutation(
  field: string,
  extra: { statsAudience?: () => string } = {
    statsAudience: () => STATS_AUDIENCE,
  },
): Resolver {
  const resolvers = createResolvers({
    config: () => config,
    store: () => store,
    ...extra,
  }) as Record<string, Record<string, Resolver>>;
  return resolvers.Mutation[field];
}

async function registeredDid(repositoryId = "123"): Promise<string> {
  const identity = (await mutation("registerWorkloadIdentity")(
    null,
    {
      input: {
        repositoryId,
        repository: "acme/shop",
        productionBranch: "main",
        ownerAddress: OWNER,
        chainId: 1,
      },
    },
    authorized,
  )) as { did: string };
  return identity.did;
}

async function code(promise: Promise<unknown>): Promise<unknown> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(GraphQLError);
  return (error as GraphQLError).extensions.code;
}

interface Issued {
  accessToken: string;
  audience: string;
  expiresIn: number;
}

beforeEach(() => {
  config = {
    encryptionKey: new Uint8Array(32).fill(5),
    registrationToken: "right-token",
    audiences: [],
  };
  store = new MemoryWorkloadStore();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("issueAppStatsToken", () => {
  it("mints a short-lived token signed by the app's did:key, for the stats audience only", async () => {
    const did = await registeredDid();
    const result = (await mutation("issueAppStatsToken")(
      null,
      { did },
      authorized,
    )) as Issued;
    expect(result.audience).toBe(STATS_AUDIENCE);
    expect(result.expiresIn).toBe(APP_STATS_TOKEN_TTL_SEC);
    expect(APP_STATS_TOKEN_TTL_SEC).toBe(600);

    const verified = await verifyAuthBearerToken(result.accessToken, {
      audience: STATS_AUDIENCE,
    });
    expect(verified && verified.issuer).toBe(did);
    expect(
      verified && verified.verifiableCredential.credentialSubject.address,
    ).toBe(getAddress(OWNER));
    expect(verified && verified.payload.aud).toBe(STATS_AUDIENCE);
    expect(verified && verified.payload.vetra).toBeUndefined();
    const { exp } = (verified as { payload: { exp: number } }).payload;
    const nowSec = Math.floor(Date.now() / 1000);
    expect(exp).toBeGreaterThan(nowSec + APP_STATS_TOKEN_TTL_SEC - 30);
    expect(exp).toBeLessThanOrEqual(nowSec + APP_STATS_TOKEN_TTL_SEC);
    // Useless as an Authorization bearer elsewhere:
    expect(await verifyAuthBearerToken(result.accessToken)).toBe(false);
    expect(
      await verifyAuthBearerToken(result.accessToken, {
        audience: "https://registry.vetra.io",
      }),
    ).toBe(false);
  });

  it("signs each app's token with that app's own key", async () => {
    const a = await registeredDid("1");
    const b = await registeredDid("2");
    const tokenA = (await mutation("issueAppStatsToken")(
      null,
      { did: a },
      authorized,
    )) as Issued;
    const tokenB = (await mutation("issueAppStatsToken")(
      null,
      { did: b },
      authorized,
    )) as Issued;
    const issuer = async (token: string) => {
      const verified = await verifyAuthBearerToken(token, {
        audience: STATS_AUDIENCE,
      });
      return verified && verified.issuer;
    };
    expect(await issuer(tokenA.accessToken)).toBe(a);
    expect(await issuer(tokenB.accessToken)).toBe(b);
  });

  it("defaults the audience to RENOWN_STATS_AUDIENCE, then the renown-stats default", async () => {
    const did = await registeredDid();
    const issue = mutation("issueAppStatsToken", {});
    expect(((await issue(null, { did }, authorized)) as Issued).audience).toBe(
      "https://switchboard.renown.vetra.io/graphql/renown-stats",
    );
    vi.stubEnv("RENOWN_STATS_AUDIENCE", "https://other.example/stats/");
    expect(((await issue(null, { did }, authorized)) as Issued).audience).toBe(
      "https://other.example/stats",
    );
  });

  it("requires the registration token", async () => {
    const did = await registeredDid();
    const issue = mutation("issueAppStatsToken");
    expect(await code(issue(null, { did }, {}))).toBe("FORBIDDEN");
    expect(
      await code(
        issue(
          null,
          { did },
          { headers: { [REGISTRATION_TOKEN_HEADER]: "wrong" } },
        ),
      ),
    ).toBe("FORBIDDEN");
    expect(
      await code(
        issue(
          null,
          { did },
          { headers: { [REGISTRATION_TOKEN_HEADER]: ["right-token"] } },
        ),
      ),
    ).toBe("FORBIDDEN");
    config = { ...config, registrationToken: null };
    expect(await code(issue(null, { did }, authorized))).toBe(
      "SERVICE_NOT_CONFIGURED",
    );
  });

  it("answers an unknown DID like any other refusal (FORBIDDEN)", async () => {
    const issue = mutation("issueAppStatsToken");
    const error = await issue(
      null,
      { did: "did:key:zUnknown" },
      authorized,
    ).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(GraphQLError);
    expect((error as GraphQLError).message).toBe("Forbidden");
    expect((error as GraphQLError).extensions.code).toBe("FORBIDDEN");
  });

  it("is SERVICE_NOT_CONFIGURED without the encryption key or the store", async () => {
    const did = await registeredDid();
    const issue = mutation("issueAppStatsToken");
    config = { ...config, encryptionKey: null };
    expect(await code(issue(null, { did }, authorized))).toBe(
      "SERVICE_NOT_CONFIGURED",
    );
    config = { ...config, encryptionKey: new Uint8Array(32).fill(5) };
    const resolvers = createResolvers({
      config: () => config,
      store: () => undefined,
    }) as Record<string, Record<string, Resolver>>;
    expect(
      await code(
        resolvers.Mutation.issueAppStatsToken(null, { did }, authorized),
      ),
    ).toBe("SERVICE_NOT_CONFIGURED");
  });

  it("is an opaque internal error when the stored key cannot be opened or does not match", async () => {
    const did = await registeredDid();
    const issue = mutation("issueAppStatsToken");
    config = { ...config, encryptionKey: new Uint8Array(32).fill(6) };
    expect(await code(issue(null, { did }, authorized))).toBe(
      "INTERNAL_SERVER_ERROR",
    );

    // A row whose sealed key pair belongs to another DID.
    config = { ...config, encryptionKey: new Uint8Array(32).fill(5) };
    const other = await generateWorkloadKey();
    const identity = await store.getByDid(did);
    await store.delete(did);
    await store.insert({
      ...identity!,
      encryptedKeyPair: await seal(
        config.encryptionKey!,
        JSON.stringify(other.keyPair),
        did,
      ),
    });
    const error = await issue(null, { did }, authorized).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect((error as GraphQLError).extensions.code).toBe(
      "INTERNAL_SERVER_ERROR",
    );
    expect((error as GraphQLError).message).toBe("Internal error");
  });
});

describe("issueAppToken", () => {
  it("refuses a key pair that does not resolve to the given DID", async () => {
    const { keyPair } = await generateWorkloadKey();
    const { did } = await generateWorkloadKey();
    await expect(
      issueAppToken({
        keyPair,
        did,
        chainId: 1,
        address: OWNER,
        audience: STATS_AUDIENCE,
        expiresInSec: 600,
      }),
    ).rejects.toThrow("Stored key pair does not match the identity's DID");
  });
});
