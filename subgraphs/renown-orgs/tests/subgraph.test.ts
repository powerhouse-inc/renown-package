import { PGlite } from "@electric-sql/pglite";
import { GraphQLError } from "graphql";
import { Kysely, sql } from "kysely";
import { PGliteDialect } from "kysely-pglite-dialect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SWEEP_INTERVAL_MS } from "../core/sweeper.js";
import { RenownOrgsSubgraph } from "../index.js";
import { PRUNE_INTERVAL_MS } from "../jobs.js";
import { KyselyOrgStore } from "../store/kysely.js";

type Resolver = (parent: unknown, args: unknown, ctx: unknown) => Promise<unknown>;

function makeSubgraph(open: () => Promise<unknown>) {
  const createNamespace = vi.fn(open);
  const subgraph = new RenownOrgsSubgraph({
    http: { owner: "@powerhousedao/renown-package", baseUrl: "https://sb.example", get: vi.fn(), post: vi.fn() },
    reactorClient: {},
    relationalDb: { createNamespace, queryNamespace: () => { throw new Error("no read models here"); } },
  } as never);
  const resolver = (type: string, field: string) =>
    (subgraph.resolvers as Record<string, Record<string, Resolver>>)[type][field];
  return { subgraph, resolver, createNamespace };
}

async function pgliteNamespace(): Promise<unknown> {
  const root = new Kysely<any>({ dialect: new PGliteDialect(new PGlite()) });
  await sql`create schema "renown-orgs"`.execute(root);
  return root.withSchema("renown-orgs");
}

describe("RenownOrgsSubgraph", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is named renown-orgs and migrates its namespace once", async () => {
    const { subgraph, resolver, createNamespace } = makeSubgraph(pgliteNamespace);
    expect(subgraph.name).toBe("renown-orgs");
    await subgraph.onSetup();
    await subgraph.onSetup();
    expect(createNamespace).toHaveBeenCalledTimes(1);
    expect(createNamespace).toHaveBeenCalledWith("renown-orgs");
    expect(await resolver("Query", "organization")(null, { id: "nope" }, {})).toBeNull();
  });

  it("never throws from setup; without its namespace every field is SERVICE_UNAVAILABLE", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { subgraph, resolver } = makeSubgraph(() => Promise.reject(new Error("db down")));
    await expect(subgraph.onSetup()).resolves.toBeUndefined();
    const error = await resolver("Query", "organization")(null, { id: "x" }, {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GraphQLError);
    expect((error as GraphQLError).extensions.code).toBe("SERVICE_UNAVAILABLE");
  });
});

describe("RenownOrgsSubgraph sweeper", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("starts one 60 s timer after setup and stops it on disconnect", async () => {
    const setSpy = vi.spyOn(globalThis, "setInterval");
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    const { subgraph } = makeSubgraph(pgliteNamespace);
    await subgraph.onSetup();
    await subgraph.onSetup();
    expect(setSpy.mock.calls.filter(([, ms]) => ms === 60_000)).toHaveLength(1);
    await subgraph.onDisconnect();
    expect(clearSpy).toHaveBeenCalledTimes(1);
  });

  it("prunes used signatures from the sweep, not before the first tick, and stops on disconnect", async () => {
    const prune = vi.spyOn(KyselyOrgStore.prototype, "pruneUsedSignatures").mockResolvedValue(0);
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { subgraph } = makeSubgraph(pgliteNamespace);
    await subgraph.onSetup();
    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS - 1);
    expect(prune).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(prune).toHaveBeenCalledTimes(1);
    expect(prune.mock.calls[0][0]).toBeInstanceOf(Date);
    await subgraph.onDisconnect();
    await vi.advanceTimersByTimeAsync(PRUNE_INTERVAL_MS * 3);
    expect(prune).toHaveBeenCalledTimes(1);
  });

  it("logs a failed sweep job instead of throwing", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(KyselyOrgStore.prototype, "pruneUsedSignatures").mockRejectedValue(new Error("db down"));
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { subgraph } = makeSubgraph(pgliteNamespace);
    await subgraph.onSetup();
    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("db down"));
    await subgraph.onDisconnect();
  });
});
