import { PGlite } from "@electric-sql/pglite";
import { GraphQLError } from "graphql";
import { Kysely, sql } from "kysely";
import { PGliteDialect } from "kysely-pglite-dialect";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as Sdk from "@renown/sdk";
import { RenownStatsSubgraph } from "../index.js";

const verifier = vi.hoisted(() => ({ fail: false }));
vi.mock("@renown/sdk", async (importOriginal) => {
  const original = await importOriginal<typeof Sdk>();
  return {
    ...original,
    verifyAuthBearerToken: (...args: Parameters<typeof original.verifyAuthBearerToken>) => {
      if (verifier.fail) return Promise.reject(new Error("boom"));
      return original.verifyAuthBearerToken(...args);
    },
  };
});

type Resolver = (parent: unknown, args: unknown, ctx: unknown) => Promise<unknown>;
const USER = "did:pkh:eip155:1:0x1111111111111111111111111111111111111111";

function makeSubgraph(open: () => Promise<unknown>) {
  const createNamespace = vi.fn(open);
  // Same constructor shape as renown-workload's subgraph test.
  const subgraph = new RenownStatsSubgraph({
    http: { owner: "@powerhousedao/renown-package", baseUrl: "https://sb.example", get: vi.fn(), post: vi.fn() },
    reactorClient: {},
    relationalDb: { createNamespace },
  } as never);
  const resolver = (type: string, field: string) =>
    (subgraph.resolvers as Record<string, Record<string, Resolver>>)[type][field];
  return { subgraph, resolver, createNamespace };
}

async function pgliteNamespace(): Promise<unknown> {
  const root = new Kysely<any>({ dialect: new PGliteDialect(new PGlite()) });
  await sql`create schema "renown-stats"`.execute(root);
  return root.withSchema("renown-stats");
}

describe("RenownStatsSubgraph", () => {
  afterEach(() => {
    verifier.fail = false;
    vi.restoreAllMocks();
  });

  it("is named renown-stats", () => {
    expect(makeSubgraph(pgliteNamespace).subgraph.name).toBe("renown-stats");
  });

  it("sets up its namespace once and serves reads", async () => {
    const { subgraph, resolver, createNamespace } = makeSubgraph(pgliteNamespace);
    await subgraph.onSetup();
    await subgraph.onSetup();
    expect(createNamespace).toHaveBeenCalledTimes(1);
    expect(createNamespace).toHaveBeenCalledWith("renown-stats");
    expect(await resolver("Query", "userStats")(null, { userDid: USER }, {})).toEqual([]);
  });

  it("never fails the host when its namespace is unavailable", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { subgraph, resolver } = makeSubgraph(() => Promise.reject(new Error("no db")));
    await expect(subgraph.onSetup()).resolves.toBeUndefined();
    const result = await resolver("Query", "userStats")(null, { userDid: USER }, {}).catch((e: unknown) => e);
    expect(result).toBeInstanceOf(GraphQLError);
    expect((result as GraphQLError).extensions.code).toBe("SERVICE_NOT_CONFIGURED");
    expect(error).toHaveBeenCalledWith(expect.stringContaining("[renown-stats]"));
    error.mockRestore();
  });

  it("refuses a malformed app token without warning; the SDK itself logs it on console.error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { subgraph, resolver } = makeSubgraph(pgliteNamespace);
    await subgraph.onSetup();
    const result = await resolver("Mutation", "reportUserStat")(
      null,
      { appDid: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK", userDid: USER, metric: "m", value: 1 },
      { headers: { "x-renown-app-token": "not-a-jwt" } },
    ).catch((e: unknown) => e);
    expect((result as GraphQLError).extensions.code).toBe("FORBIDDEN");
    expect(warn).not.toHaveBeenCalled();
    // verifyAuthBearerToken swallows the failure and logs it itself; our
    // debug-level catch is not reached. We cannot keep it out of error logs.
    expect(error).toHaveBeenCalled();
    expect(debug).not.toHaveBeenCalled();
  });

  it("logs at debug, not warn, if token verification ever throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    verifier.fail = true;
    const { subgraph, resolver } = makeSubgraph(pgliteNamespace);
    await subgraph.onSetup();
    const result = await resolver("Mutation", "reportUserStat")(
      null,
      { appDid: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK", userDid: USER, metric: "m", value: 1 },
      { headers: { "x-renown-app-token": "not-a-jwt" } },
    ).catch((e: unknown) => e);
    expect((result as GraphQLError).extensions.code).toBe("FORBIDDEN");
    expect(warn).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledWith(
      expect.stringContaining("app token verification failed"),
    );
  });

  it("refuses every profile upsert when RENOWN_STATS_PROFILE_APPS is unset", async () => {
    vi.stubEnv("RENOWN_STATS_PROFILE_APPS", undefined);
    try {
      const { subgraph, resolver } = makeSubgraph(pgliteNamespace);
      await subgraph.onSetup();
      const result = await resolver("Mutation", "upsertAppProfile")(
        null,
        { appDid: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK", name: "x" },
        {
          user: {
            address: "0xabc0000000000000000000000000000000000001",
            appKey: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
          },
        },
      ).catch((e: unknown) => e);
      expect(result).toBeInstanceOf(GraphQLError);
      expect((result as GraphQLError).extensions.code).toBe("FORBIDDEN");
      expect((result as GraphQLError).message).toBe("Forbidden");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("survives a failing migration", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { subgraph } = makeSubgraph(() => Promise.resolve({}));
    await expect(subgraph.onSetup()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.stringContaining("[renown-stats]"));
    error.mockRestore();
  });
});

describe("RenownStatsSubgraph metric backfill", () => {
  it("runs the one-time backfill at setup and records it", async () => {
    let namespace: Kysely<{ renown_stats_jobs: { name: string } }> | undefined;
    const { subgraph } = makeSubgraph(async () => {
      namespace = (await pgliteNamespace()) as Kysely<{ renown_stats_jobs: { name: string } }>;
      return namespace;
    });
    await subgraph.onSetup();
    await subgraph.backfillSettled();
    const jobs = await namespace!.selectFrom("renown_stats_jobs").select("name").execute();
    expect(jobs.map((job) => job.name)).toEqual(["app-metric-values-backfill-v1"]);
  });
});
