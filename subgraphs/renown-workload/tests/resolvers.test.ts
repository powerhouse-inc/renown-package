import {
  buildASTSchema,
  GraphQLError,
  type GraphQLInputObjectType,
  type GraphQLObjectType,
} from "graphql";
import { getAddress } from "viem";
import { beforeEach, describe, expect, it } from "vitest";
import type { WorkloadConfig } from "../core/types.js";
import { createResolvers, REGISTRATION_TOKEN_HEADER } from "../resolvers.js";
import { schema } from "../schema.js";
import { MemoryWorkloadStore } from "../store/memory.js";

type Resolver = (
  parent: unknown,
  args: unknown,
  ctx: unknown,
) => Promise<unknown>;

const KEY = new Uint8Array(32).fill(5);
const OWNER = "0xabcdef0123456789abcdef0123456789abcdef01";
const OTHER = "0x1111111111111111111111111111111111111111";
const authorized = { headers: { [REGISTRATION_TOKEN_HEADER]: "right-token" } };
const input = {
  repositoryId: "123",
  repository: "acme/shop",
  productionBranch: "main",
  ownerAddress: OWNER,
  chainId: 1,
};

let config: WorkloadConfig;
let store: MemoryWorkloadStore | undefined;

function resolver(type: "Query" | "Mutation", field: string): Resolver {
  const resolvers = createResolvers({
    config: () => config,
    store: () => store,
  }) as Record<string, Record<string, Resolver>>;
  return resolvers[type][field];
}

const register = (args: unknown, ctx: unknown = authorized) =>
  resolver("Mutation", "registerWorkloadIdentity")(null, args, ctx);

async function code(promise: Promise<unknown>): Promise<unknown> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(GraphQLError);
  return (error as GraphQLError).extensions.code;
}

beforeEach(() => {
  config = {
    encryptionKey: KEY,
    registrationToken: "right-token",
    audiences: [],
  };
  store = new MemoryWorkloadStore();
});

describe("workload identity resolvers", () => {
  it("registers an identity and returns it without key material", async () => {
    const identity = (await register({ input })) as Record<string, unknown>;
    expect(identity).toMatchObject({
      provider: "github",
      repositoryId: "123",
      repository: "acme/shop",
      productionBranch: "main",
      ownerAddress: getAddress(OWNER),
      chainId: 1,
    });
    expect(identity.did).toMatch(/^did:key:zDn/);
    expect(typeof identity.createdAt).toBe("string");
    expect(JSON.stringify(identity)).not.toMatch(/encrypted|"d"/);
  });

  it.each([
    ["without the header", {}],
    [
      "with the wrong header",
      { headers: { [REGISTRATION_TOKEN_HEADER]: "wrong-token" } },
    ],
    [
      "with the token as a bearer",
      { headers: { authorization: "Bearer right-token" } },
    ],
  ])("is FORBIDDEN %s", async (_name, ctx) => {
    expect(await code(register({ input }, ctx))).toBe("FORBIDDEN");
    expect(
      await code(
        resolver("Query", "workloadIdentity")(null, { did: "x" }, ctx),
      ),
    ).toBe("FORBIDDEN");
    expect(
      await code(
        resolver("Mutation", "updateWorkloadIdentity")(null, { did: "x" }, ctx),
      ),
    ).toBe("FORBIDDEN");
    expect(
      await code(
        resolver("Mutation", "deleteWorkloadIdentity")(null, { did: "x" }, ctx),
      ),
    ).toBe("FORBIDDEN");
  });

  it("is SERVICE_NOT_CONFIGURED when the registration token is unset (even with an empty header)", async () => {
    config = { ...config, registrationToken: null };
    expect(
      await code(
        register({ input }, { headers: { [REGISTRATION_TOKEN_HEADER]: "" } }),
      ),
    ).toBe("SERVICE_NOT_CONFIGURED");
  });

  it("is SERVICE_NOT_CONFIGURED without an encryption key or store", async () => {
    config = { ...config, encryptionKey: null };
    expect(await code(register({ input }))).toBe("SERVICE_NOT_CONFIGURED");
    config = { ...config, encryptionKey: KEY };
    store = undefined;
    expect(await code(register({ input }))).toBe("SERVICE_NOT_CONFIGURED");
  });

  it("is idempotent per repository for the same owner (any address case)", async () => {
    const first = (await register({ input })) as { did: string };
    const again = (await register({
      input: {
        ...input,
        ownerAddress: OWNER.toUpperCase().replace("0X", "0x"),
      },
    })) as {
      did: string;
    };
    expect(again.did).toBe(first.did);
  });

  it("is a CONFLICT for another owner (or chain) of the same repository", async () => {
    await register({ input });
    expect(
      await code(register({ input: { ...input, ownerAddress: OTHER } })),
    ).toBe("CONFLICT");
    expect(await code(register({ input: { ...input, chainId: 10 } }))).toBe(
      "CONFLICT",
    );
  });

  it.each([
    ["repositoryId", { repositoryId: "abc" }],
    ["repository", { repository: "not a repo" }],
    ["productionBranch", { productionBranch: "refs/heads/main" }],
    ["productionBranch", { productionBranch: "a..b" }],
    ["ownerAddress", { ownerAddress: "0x123" }],
    ["chainId", { chainId: 0 }],
  ])("rejects an invalid %s as BAD_USER_INPUT", async (_field, patch) => {
    expect(await code(register({ input: { ...input, ...patch } }))).toBe(
      "BAD_USER_INPUT",
    );
  });

  it("registers without release branches by default", async () => {
    expect(await register({ input })).toMatchObject({ releaseBranches: [] });
  });

  it("registers release branches in the order given, without duplicates", async () => {
    expect(
      await register({
        input: {
          ...input,
          releaseBranches: ["next", "*.x", "release/*", "next"],
        },
      }),
    ).toMatchObject({ releaseBranches: ["next", "*.x", "release/*"] });
  });

  it.each([
    [""],
    ["a**"],
    ["**"],
    ["v?"],
    ["[12].x"],
    ["{a,b}"],
    ["a..*"],
    ["-*"],
    ["*/"],
    ["*.lock"],
    ["refs/heads/*"],
    ["a b"],
    ["x".repeat(256)],
  ])(
    "refuses the release branch %j as BAD_USER_INPUT, naming it",
    async (entry) => {
      const error = await register({
        input: { ...input, releaseBranches: ["next", entry] },
      }).then(
        () => undefined,
        (e: unknown) => e as GraphQLError,
      );
      expect(error?.extensions.code).toBe("BAD_USER_INPUT");
      expect(error?.message).toContain(JSON.stringify(entry).slice(0, 40));
    },
  );

  it("refuses a bare * (every top-level branch) but keeps narrower patterns", async () => {
    const error = await register({
      input: { ...input, releaseBranches: ["*"] },
    }).then(
      () => undefined,
      (e: unknown) => e as GraphQLError,
    );
    expect(error?.extensions.code).toBe("BAD_USER_INPUT");
    expect(error?.message).toContain("every top-level branch");
    expect(
      await register({
        input: { ...input, releaseBranches: ["*.x", "release/*"] },
      }),
    ).toMatchObject({ releaseBranches: ["*.x", "release/*"] });
  });

  it("caps release branches at 20 (after removing duplicates)", async () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `b${i}`);
    expect(
      await code(
        register({ input: { ...input, releaseBranches: [...twenty, "b20"] } }),
      ),
    ).toBe("BAD_USER_INPUT");
    expect(
      await register({
        input: { ...input, releaseBranches: [...twenty, "b0"] },
      }),
    ).toMatchObject({ releaseBranches: twenty });
  });

  it("replaces release branches on update, clears them with [], keeps them when omitted", async () => {
    const { did } = (await register({ input })) as { did: string };
    const update = (args: Record<string, unknown>) =>
      resolver("Mutation", "updateWorkloadIdentity")(
        null,
        { did, ...args },
        authorized,
      );
    expect(await update({ releaseBranches: ["next", "*.x"] })).toMatchObject({
      releaseBranches: ["next", "*.x"],
    });
    expect(await update({ productionBranch: "trunk" })).toMatchObject({
      productionBranch: "trunk",
      releaseBranches: ["next", "*.x"],
    });
    expect(await update({ releaseBranches: null })).toMatchObject({
      releaseBranches: ["next", "*.x"],
    });
    expect(await update({ releaseBranches: ["1.x", "1.x"] })).toMatchObject({
      releaseBranches: ["1.x"],
    });
    expect(await code(update({ releaseBranches: ["a**"] }))).toBe(
      "BAD_USER_INPUT",
    );
    expect(await update({ releaseBranches: [] })).toMatchObject({
      releaseBranches: [],
    });
  });

  it("stores the private key encrypted: the row never contains the JWK's d in clear", async () => {
    const { did } = (await register({ input })) as { did: string };
    const row = await store!.getByDid(did);
    expect(row!.encryptedKeyPair).toMatch(/^v1\./);
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain('"d"');
    expect(serialized).not.toContain("privateKey");
    expect(serialized).not.toContain("P-256");
  });

  it("reads, updates and deletes an identity", async () => {
    const { did } = (await register({ input })) as { did: string };
    const read = resolver("Query", "workloadIdentity");
    expect(await read(null, { did }, authorized)).toMatchObject({
      did,
      productionBranch: "main",
    });

    const updated = await resolver("Mutation", "updateWorkloadIdentity")(
      null,
      { did, repository: "acme/renamed", productionBranch: "release" },
      authorized,
    );
    expect(updated).toMatchObject({
      repository: "acme/renamed",
      productionBranch: "release",
    });
    expect(
      await code(
        resolver("Mutation", "updateWorkloadIdentity")(
          null,
          { did, productionBranch: "-x" },
          authorized,
        ),
      ),
    ).toBe("BAD_USER_INPUT");
    expect(
      await code(
        resolver("Mutation", "updateWorkloadIdentity")(
          null,
          { did: "did:key:none" },
          authorized,
        ),
      ),
    ).toBe("NOT_FOUND");

    const del = resolver("Mutation", "deleteWorkloadIdentity");
    expect(await del(null, { did }, authorized)).toBe(true);
    expect(await del(null, { did }, authorized)).toBe(false);
    expect(await read(null, { did }, authorized)).toBeNull();
  });
});

describe("workload identity schema", () => {
  it("exposes release branches on the identity, registration and update", () => {
    const built = buildASTSchema(schema);
    const identity = built.getType("WorkloadIdentity") as GraphQLObjectType;
    expect(String(identity.getFields().releaseBranches.type)).toBe(
      "[String!]!",
    );
    const input = built.getType(
      "RegisterWorkloadIdentityInput",
    ) as GraphQLInputObjectType;
    expect(String(input.getFields().releaseBranches.type)).toBe("[String!]");
    const update = built.getMutationType()!.getFields().updateWorkloadIdentity;
    expect(
      String(update.args.find((a) => a.name === "releaseBranches")?.type),
    ).toBe("[String!]");
  });
});
