import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { exportJWK, generateKeyPair } from "jose";
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from "kysely";
import type { RouteContext, RouteHandler, RouteOptions } from "@powerhousedao/reactor-api";
import { RenownOidcSubgraph } from "../index.js";

const baseUrl = "https://sb.example/api/@powerhousedao/renown-package";

interface Registered {
  method: "GET" | "POST";
  path: string;
  options: RouteOptions;
  handler: RouteHandler;
  dispose: ReturnType<typeof vi.fn>;
}

function stubHttp() {
  const routes: Registered[] = [];
  const register =
    (method: "GET" | "POST") =>
    (path: string, options: RouteOptions, handler: RouteHandler) => {
      const dispose = vi.fn();
      routes.push({ method, path, options, handler, dispose });
      return { url: `${baseUrl}/${path}`, dispose };
    };
  return { routes, http: { owner: "@powerhousedao/renown-package", baseUrl, get: register("GET"), post: register("POST") } };
}

function dummyDb() {
  return new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
}

function makeSubgraph() {
  const { routes, http } = stubHttp();
  const createNamespace = vi.fn(() => Promise.resolve(dummyDb()));
  const reactorClient = {
    get: vi.fn<(id: string) => Promise<unknown>>(() => Promise.reject(new Error("not found"))),
    createEmpty: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    execute: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  };
  const subgraph = new RenownOidcSubgraph({
    http,
    reactorClient,
    relationalDb: { createNamespace },
  } as never);
  return { subgraph, routes, createNamespace, reactorClient };
}

async function signingKeysEnv(): Promise<string> {
  const { privateKey } = await generateKeyPair("ES256", { extractable: true });
  return JSON.stringify([{ ...(await exportJWK(privateKey)), kid: "k1" }]);
}

const ctx = (params: Record<string, string> = {}) => ({ params }) as unknown as RouteContext;

const ENV_KEYS = ["RENOWN_OIDC_SIGNING_KEYS", "RENOWN_OIDC_REGISTRATION_TOKEN", "RENOWN_OIDC_ISSUER"] as const;
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
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  vi.restoreAllMocks();
});

describe("RenownOidcSubgraph", () => {
  it("is named renown-oidc", () => {
    expect(makeSubgraph().subgraph.name).toBe("renown-oidc");
  });

  it("registers no routes and does not throw when signing keys are unset", async () => {
    const { subgraph, routes, createNamespace } = makeSubgraph();
    await expect(subgraph.onSetup()).resolves.toBeUndefined();
    expect(routes).toHaveLength(0);
    expect(createNamespace).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith("[renown-oidc] RENOWN_OIDC_SIGNING_KEYS unset — OIDC endpoints disabled");
    await expect(subgraph.onDisconnect()).resolves.toBeUndefined();
  });

  it("registers no routes, does not throw, and never logs key material when signing keys are invalid", async () => {
    process.env.RENOWN_OIDC_SIGNING_KEYS = '[{"kty":"oct","k":"c2VjcmV0LWtleS1tYXRlcmlhbA"}]';
    const { subgraph, routes } = makeSubgraph();
    await expect(subgraph.onSetup()).resolves.toBeUndefined();
    expect(routes).toHaveLength(0);
    const logged = JSON.stringify([...warn.mock.calls, ...error.mock.calls]);
    expect(logged).not.toContain("c2VjcmV0LWtleS1tYXRlcmlhbA");
  });

  it("registers the 8 public OIDC routes when a valid key is configured", async () => {
    process.env.RENOWN_OIDC_SIGNING_KEYS = await signingKeysEnv();
    const { subgraph, routes, createNamespace } = makeSubgraph();
    await subgraph.onSetup();
    expect(createNamespace).toHaveBeenCalledWith("renown-oidc");
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual([
      "GET oidc/.well-known/openid-configuration",
      "GET oidc/jwks",
      "GET oidc/authorize",
      "GET oidc/interaction/:id",
      "POST oidc/interaction/:id/complete",
      "POST oidc/token",
      "GET oidc/userinfo",
      "POST oidc/userinfo",
    ]);
    for (const route of routes) expect(route.options).toEqual({ auth: "public" });
    await subgraph.onDisconnect();
  });

  it("serves discovery with the issuer derived from the http base url", async () => {
    process.env.RENOWN_OIDC_SIGNING_KEYS = await signingKeysEnv();
    const { subgraph, routes } = makeSubgraph();
    await subgraph.onSetup();
    const discovery = routes.find((r) => r.path === "oidc/.well-known/openid-configuration")!;
    const res = await discovery.handler(new Request(`${baseUrl}/oidc/.well-known/openid-configuration`), ctx());
    expect(((await res.json()) as { issuer: string }).issuer).toBe(`${baseUrl}/oidc`);
    await subgraph.onDisconnect();
  });

  it("passes the :id path param to the interaction handler", async () => {
    process.env.RENOWN_OIDC_SIGNING_KEYS = await signingKeysEnv();
    const { subgraph, routes } = makeSubgraph();
    await subgraph.onSetup();
    const interaction = routes.find((r) => r.path === "oidc/interaction/:id")!;
    // The dummy store finds no login request for this id, so a 4xx proves the id reached the handler without error.
    const res = await interaction.handler(new Request(`${baseUrl}/oidc/interaction/abc`), ctx({ id: "abc" }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    await subgraph.onDisconnect();
  });

  it("disposes every route and clears the cleanup interval on disconnect", async () => {
    process.env.RENOWN_OIDC_SIGNING_KEYS = await signingKeysEnv();
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    const { subgraph, routes } = makeSubgraph();
    await subgraph.onSetup();
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 300_000);
    const timer = setIntervalSpy.mock.results[0].value as unknown;
    await subgraph.onDisconnect();
    for (const route of routes) expect(route.dispose).toHaveBeenCalledOnce();
    expect(clearIntervalSpy).toHaveBeenCalledWith(timer);
  });

  it("registers no routes and does not throw when the relational namespace cannot be created", async () => {
    process.env.RENOWN_OIDC_SIGNING_KEYS = await signingKeysEnv();
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const { subgraph, routes, createNamespace } = makeSubgraph();
    createNamespace.mockRejectedValueOnce(new Error("db down"));
    await expect(subgraph.onSetup()).resolves.toBeUndefined();
    expect(routes).toHaveLength(0);
    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      "[renown-oidc] relational namespace/migration failed (db down) — OIDC endpoints disabled",
    );
  });

  it("registers no routes and does not throw when the migration fails", async () => {
    process.env.RENOWN_OIDC_SIGNING_KEYS = await signingKeysEnv();
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const { subgraph, routes, createNamespace } = makeSubgraph();
    const failingDb = {
      schema: {
        createTable: () => {
          throw new Error("permission denied for schema");
        },
      },
    };
    createNamespace.mockResolvedValueOnce(failingDb as never);
    await expect(subgraph.onSetup()).resolves.toBeUndefined();
    expect(routes).toHaveLength(0);
    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      "[renown-oidc] relational namespace/migration failed (permission denied for schema) — OIDC endpoints disabled",
    );
  });

  it("is idempotent: a second onSetup registers no duplicate routes or timers", async () => {
    process.env.RENOWN_OIDC_SIGNING_KEYS = await signingKeysEnv();
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const { subgraph, routes } = makeSubgraph();
    await subgraph.onSetup();
    await subgraph.onSetup();
    expect(routes).toHaveLength(8);
    expect(setIntervalSpy).toHaveBeenCalledOnce();
    await subgraph.onDisconnect();
  });

  describe("GraphQL", () => {
    type Resolver = (parent: unknown, args: unknown, ctx: unknown) => Promise<unknown>;
    const resolver = (subgraph: RenownOidcSubgraph, type: "Query" | "Mutation", field: string) =>
      (subgraph.resolvers as Record<string, Record<string, Resolver>>)[type][field];
    const registerArgs = { input: { name: "x", redirectUris: [], allowedSubjects: [], confidential: true } };

    it("serves the resolvers even when signing keys are unset", async () => {
      const { subgraph } = makeSubgraph();
      await subgraph.onSetup();
      expect(resolver(subgraph, "Query", "oidcClient")).toBeTypeOf("function");
      expect(resolver(subgraph, "Mutation", "registerOidcClient")).toBeTypeOf("function");
    });

    it("rejects registration when the registration token is unset", async () => {
      const { subgraph, reactorClient } = makeSubgraph();
      await subgraph.onSetup();
      await expect(
        resolver(subgraph, "Mutation", "registerOidcClient")(null, registerArgs, { headers: { authorization: "Bearer " } }),
      ).rejects.toThrow("Unauthorized");
      expect(reactorClient.createEmpty).not.toHaveBeenCalled();
    });

    it("rejects registration with a wrong bearer token", async () => {
      process.env.RENOWN_OIDC_REGISTRATION_TOKEN = "right-token";
      const { subgraph, reactorClient } = makeSubgraph();
      await subgraph.onSetup();
      const register = resolver(subgraph, "Mutation", "registerOidcClient");
      await expect(register(null, registerArgs, { headers: { authorization: "Bearer wrong-token" } })).rejects.toThrow(
        "Unauthorized",
      );
      await expect(register(null, registerArgs, { headers: {} })).rejects.toThrow("Unauthorized");
      expect(reactorClient.createEmpty).not.toHaveBeenCalled();
    });

    it("registers a client with the right bearer token", async () => {
      process.env.RENOWN_OIDC_REGISTRATION_TOKEN = "right-token";
      const { subgraph, reactorClient } = makeSubgraph();
      reactorClient.createEmpty.mockResolvedValue({ header: { id: "doc-7" } });
      reactorClient.execute.mockResolvedValue({ operations: { global: [] } });
      await subgraph.onSetup();
      const result = await resolver(subgraph, "Mutation", "registerOidcClient")(
        null,
        { input: { ...registerArgs.input, confidential: false } },
        { headers: { authorization: "Bearer right-token" } },
      );
      expect(result).toEqual({ clientId: "doc-7", clientSecret: null });
    });

    it("oidcClient returns public info only, and null for a missing or foreign document", async () => {
      const { subgraph, reactorClient } = makeSubgraph();
      await subgraph.onSetup();
      const query = resolver(subgraph, "Query", "oidcClient");
      expect(await query(null, { clientId: "missing" }, {})).toBeNull();

      reactorClient.get.mockResolvedValueOnce({
        header: { id: "doc-1", documentType: "renown/oidc-client" },
        state: {
          global: {
            name: "Speckle",
            redirectUris: ["https://a.example/cb"],
            allowedSubjects: ["0xabc"],
            allowAnySubject: false,
            clientSecretHash: "sha256:00",
            status: "ACTIVE",
          },
        },
      });
      expect(await query(null, { clientId: "doc-1" }, {})).toEqual({
        clientId: "doc-1",
        name: "Speckle",
        redirectUris: ["https://a.example/cb"],
        status: "ACTIVE",
      });

      reactorClient.get.mockResolvedValueOnce({ header: { id: "u", documentType: "powerhouse/renown-user" }, state: { global: {} } });
      expect(await query(null, { clientId: "u" }, {})).toBeNull();
    });
  });
});
