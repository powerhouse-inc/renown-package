import { GraphQLError } from "graphql";
import { getAddress } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkloadConfig } from "../core/types.js";
import { createGithubVerifier } from "../core/github.js";
import { DEFAULT_AUDIENCES } from "../core/config.js";
import { createTokenHandler } from "../http/handlers.js";
import { createResolvers, REGISTRATION_TOKEN_HEADER } from "../resolvers.js";
import { MemoryWorkloadStore } from "../store/memory.js";
import type { OrgRole } from "../../renown-orgs/store/types.js";
import { githubJwks, githubToken, pushClaims, REPOSITORY_ID } from "./github-fixture.js";

type Resolver = (parent: unknown, args: unknown, ctx: unknown) => Promise<unknown>;
const OWNER = getAddress("0xabcdef0123456789abcdef0123456789abcdef01");
const authorized = { headers: { [REGISTRATION_TOKEN_HEADER]: "right-token" } };
const config: WorkloadConfig = { encryptionKey: new Uint8Array(32).fill(5), registrationToken: "right-token", audiences: DEFAULT_AUDIENCES };
let store: MemoryWorkloadStore;
const policy = { roles: new Map<string, OrgRole>(), frozen: new Set<string>(), down: false };
const orgPolicy = () => ({
  activeRole: (orgId: string, address: string) => Promise.resolve(policy.roles.get(`${orgId}:${address.toLowerCase()}`) ?? null),
  orgOfApp: (appDid: string) =>
    policy.down ? Promise.reject(new Error("renown-orgs namespace unreadable")) : Promise.resolve(policy.frozen.has(appDid) ? { orgId: "o1", frozen: true } : null),
});

function resolver(type: "Query" | "Mutation", field: string): Resolver {
  return (createResolvers({ config: () => config, store: () => store, orgPolicy, statsAudience: () => "https://stats.example" }) as Record<string, Record<string, Resolver>>)[type][field];
}

const register = (ownerOrgId?: string) =>
  resolver("Mutation", "registerWorkloadIdentity")(
    null,
    { input: { repositoryId: REPOSITORY_ID, repository: "acme/shop", productionBranch: "main", ownerAddress: OWNER, chainId: 1, ownerOrgId } },
    authorized,
  ) as Promise<{ did: string; ownerOrgId: string | null; disabled: boolean }>;

async function code(promise: Promise<unknown>): Promise<unknown> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(GraphQLError);
  return (error as GraphQLError).extensions.code;
}

function exchange() {
  return createTokenHandler(() => ({
    store,
    encryptionKey: config.encryptionKey!,
    audiences: DEFAULT_AUDIENCES,
    verifier: createGithubVerifier({ fetchJwks: githubJwks }),
    orgPolicy: orgPolicy(),
    log: () => undefined,
  }));
}

async function exchangeToken(): Promise<Response> {
  return exchange()(
    new Request("https://sb.example/workload/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject_token: await githubToken(pushClaims("refs/heads/main")), audience: "https://registry.dev.vetra.io" }),
    }),
  );
}

beforeEach(() => {
  store = new MemoryWorkloadStore();
  policy.roles.clear();
  policy.frozen.clear();
  policy.down = false;
});

describe("org-owned workload identities", () => {
  it("registers for an organization only when the owner is a publisher there", async () => {
    expect(await code(register("o1"))).toBe("FORBIDDEN");
    policy.roles.set(`o1:${OWNER.toLowerCase()}`, "MEMBER");
    expect(await code(register("o1"))).toBe("FORBIDDEN");
    policy.roles.set(`o1:${OWNER.toLowerCase()}`, "PUBLISHER");
    expect(await register("o1")).toMatchObject({ ownerOrgId: "o1", disabled: false });
    expect(await store.getByRepositoryId(REPOSITORY_ID)).toMatchObject({ ownerOrgId: "o1" });
  });

  it("registers person-owned identities without an organization", async () => {
    expect(await register()).toMatchObject({ ownerOrgId: null, disabled: false });
  });

  it("answers 503, issuing nothing, when organisation rules cannot be read", async () => {
    await register();
    policy.down = true;
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await exchangeToken();
    errors.mockRestore();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "temporarily_unavailable" });
  });

  it("issues no tokens for a disabled identity or a frozen app", async () => {
    const { did } = await register();
    const stored = await store.getByDid(did);
    const issue = () => resolver("Mutation", "issueAppStatsToken")(null, { did }, authorized);
    await expect(issue()).resolves.toMatchObject({ audience: "https://stats.example" });
    expect((await exchangeToken()).status).toBe(200);

    policy.frozen.add(did);
    expect(await code(issue())).toBe("FORBIDDEN");
    const frozen = await exchangeToken();
    expect(frozen.status).toBe(403);
    expect(((await frozen.json()) as { error_description: string }).error_description).toMatch(/frozen/);
    policy.frozen.clear();

    store = new MemoryWorkloadStore();
    await store.insert({ ...stored!, disabled: true });
    expect(await code(issue())).toBe("FORBIDDEN");
    const disabled = await exchangeToken();
    expect(disabled.status).toBe(403);
    expect(((await disabled.json()) as { error_description: string }).error_description).toMatch(/disabled/);
  });
});
