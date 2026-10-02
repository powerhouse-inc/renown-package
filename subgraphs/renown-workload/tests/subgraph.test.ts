import { PGlite } from "@electric-sql/pglite";
import type {
  RouteContext,
  RouteHandler,
  RouteOptions,
} from "@powerhousedao/reactor-api";
import { verifyAuthBearerToken } from "@renown/sdk";
import type { GraphQLError } from "graphql";
import { Kysely, sql } from "kysely";
import { PGliteDialect } from "kysely-pglite-dialect";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { GITHUB_JWKS_URL } from "../core/github.js";
import { RenownWorkloadSubgraph } from "../index.js";
import { REGISTRATION_TOKEN_HEADER } from "../resolvers.js";
import {
  githubJwks,
  githubToken,
  prClaims,
  REPOSITORY_ID,
} from "./github-fixture.js";

const baseUrl = "https://sb.example/api/@powerhousedao/renown-package";
const OWNER = "0xabcdef0123456789abcdef0123456789abcdef01";

interface Registered {
  method: string;
  path: string;
  options: RouteOptions;
  handler: RouteHandler;
  dispose: ReturnType<typeof vi.fn>;
}

type Resolver = (
  parent: unknown,
  args: unknown,
  ctx: unknown,
) => Promise<unknown>;

function makeSubgraph(createNamespace: () => Promise<unknown>) {
  const routes: Registered[] = [];
  const register =
    (method: string) =>
    (path: string, options: RouteOptions, handler: RouteHandler) => {
      const dispose = vi.fn();
      routes.push({ method, path, options, handler, dispose });
      return { url: `${baseUrl}/${path}`, dispose };
    };
  const subgraph = new RenownWorkloadSubgraph({
    http: {
      owner: "@powerhousedao/renown-package",
      baseUrl,
      get: register("GET"),
      post: register("POST"),
    },
    reactorClient: {},
    relationalDb: { createNamespace: vi.fn(createNamespace) },
  } as never);
  const resolver = (type: string, field: string) =>
    (subgraph.resolvers as Record<string, Record<string, Resolver>>)[type][
      field
    ];
  return { subgraph, routes, resolver };
}

async function pgliteNamespace(): Promise<unknown> {
  const root = new Kysely<any>({ dialect: new PGliteDialect(new PGlite()) });
  await sql`create schema "renown-workload"`.execute(root);
  return root.withSchema("renown-workload");
}

const tokenRequest = (body: unknown) =>
  new Request(`${baseUrl}/workload/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const ENV_KEYS = [
  "RENOWN_WORKLOAD_KEY_ENCRYPTION_KEY",
  "RENOWN_WORKLOAD_REGISTRATION_TOKEN",
  "RENOWN_WORKLOAD_AUDIENCES",
] as const;
const savedEnv: Record<string, string | undefined> = {};
let warn: MockInstance<typeof console.warn>;
let error: MockInstance<typeof console.error>;

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("RenownWorkloadSubgraph", () => {
  it("is named renown-workload", () => {
    expect(makeSubgraph(pgliteNamespace).subgraph.name).toBe("renown-workload");
  });

  it("boots without any config: the route answers 503 and the API fails SERVICE_NOT_CONFIGURED", async () => {
    const { subgraph, routes, resolver } = makeSubgraph(pgliteNamespace);
    await expect(subgraph.onSetup()).resolves.toBeUndefined();
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual([
      "POST workload/token",
    ]);
    expect(routes[0].options).toEqual({ auth: "public" });

    const res = await routes[0].handler(
      tokenRequest({ subject_token: "x", audience: "y" }),
      {} as RouteContext,
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "temporarily_unavailable" });

    const err = await resolver("Mutation", "registerWorkloadIdentity")(
      null,
      { input: {} },
      { headers: {} },
    ).catch((e: unknown) => e);
    expect((err as GraphQLError).extensions.code).toBe(
      "SERVICE_NOT_CONFIGURED",
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("RENOWN_WORKLOAD_KEY_ENCRYPTION_KEY unset"),
    );
    await subgraph.onDisconnect();
    expect(routes[0].dispose).toHaveBeenCalledOnce();
  });

  it("does not throw and answers 503 when the relational namespace fails", async () => {
    process.env.RENOWN_WORKLOAD_KEY_ENCRYPTION_KEY = Buffer.alloc(
      32,
      1,
    ).toString("base64");
    const { subgraph, routes } = makeSubgraph(() =>
      Promise.reject(new Error("db down")),
    );
    await expect(subgraph.onSetup()).resolves.toBeUndefined();
    const res = await routes[0].handler(
      tokenRequest({ subject_token: "x", audience: "y" }),
      {} as RouteContext,
    );
    expect(res.status).toBe(503);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("(db down)"));
  });

  it("sets up only once", async () => {
    const { subgraph, routes } = makeSubgraph(pgliteNamespace);
    await subgraph.onSetup();
    await subgraph.onSetup();
    expect(routes).toHaveLength(1);
  });

  it("registers an identity over GraphQL and exchanges a GitHub token end to end", async () => {
    process.env.RENOWN_WORKLOAD_KEY_ENCRYPTION_KEY = Buffer.alloc(
      32,
      1,
    ).toString("base64");
    process.env.RENOWN_WORKLOAD_REGISTRATION_TOKEN = "reg-token";
    const jwks = await githubJwks();
    const fetchSpy = vi.fn((url: string) => {
      expect(url).toBe(GITHUB_JWKS_URL);
      return Promise.resolve(
        new Response(JSON.stringify(jwks), {
          headers: { "content-type": "application/json" },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchSpy);

    const { subgraph, routes, resolver } = makeSubgraph(pgliteNamespace);
    await subgraph.onSetup();
    const identity = (await resolver("Mutation", "registerWorkloadIdentity")(
      null,
      {
        input: {
          repositoryId: REPOSITORY_ID,
          repository: "acme/shop",
          productionBranch: "main",
          ownerAddress: OWNER,
          chainId: 1,
        },
      },
      { headers: { [REGISTRATION_TOKEN_HEADER]: "reg-token" } },
    )) as { did: string };

    const res = await routes[0].handler(
      tokenRequest({
        subject_token: await githubToken(prClaims()),
        audience: "https://switchboard.vetra.io/",
      }),
      {} as RouteContext,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { access_token: string };
    const verified = await verifyAuthBearerToken(body.access_token, {
      audience: "https://switchboard.vetra.io",
    });
    expect(verified && verified.issuer).toBe(identity.did);
    expect(fetchSpy).toHaveBeenCalledOnce();
    await subgraph.onDisconnect();
  });
});
