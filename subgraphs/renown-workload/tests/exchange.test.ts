import { verifyAuthBearerToken } from "@renown/sdk";
import { getAddress } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AUDIENCES } from "../core/config.js";
import { createGithubVerifier } from "../core/github.js";
import { createTokenHandler, type ExchangeDeps } from "../http/handlers.js";
import { registerWorkloadIdentity } from "../registry.js";
import { MemoryWorkloadStore } from "../store/memory.js";
import {
  githubJwks,
  githubToken,
  prClaims,
  REPOSITORY,
  REPOSITORY_ID,
} from "./github-fixture.js";

const URL_ =
  "https://sb.example/api/@powerhousedao/renown-package/workload/token";
const KEY = new Uint8Array(32).fill(3);
const OWNER = getAddress("0xabcdef0123456789abcdef0123456789abcdef01");
const DEV_REGISTRY = "https://registry.dev.vetra.io";
const PROD_REGISTRY = "https://registry.vetra.io";

let deps: ExchangeDeps;
let did: string;
let logs: string[];

beforeEach(async () => {
  const store = new MemoryWorkloadStore();
  const identity = await registerWorkloadIdentity(
    { store, encryptionKey: KEY, now: () => new Date() },
    {
      repositoryId: REPOSITORY_ID,
      repository: "acme/shop",
      productionBranch: "main",
      ownerAddress: OWNER,
      chainId: 1,
    },
  );
  did = identity.did;
  logs = [];
  deps = {
    store,
    encryptionKey: KEY,
    audiences: DEFAULT_AUDIENCES,
    verifier: createGithubVerifier({ fetchJwks: githubJwks }),
    log: (m) => logs.push(m),
  };
});

function post(body: unknown, contentType = "application/json"): Request {
  return new Request(URL_, {
    method: "POST",
    headers: { "content-type": contentType },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function exchange(
  subjectToken: string,
  audience = DEV_REGISTRY,
  d: ExchangeDeps | null = deps,
) {
  const res = await createTokenHandler(() => d)(
    post({ subject_token: subjectToken, audience }),
  );
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

describe("POST workload/token", () => {
  it("exchanges a pull request token for a PREVIEW bearer the SDK verifies", async () => {
    const { status, body } = await exchange(await githubToken(prClaims()));
    expect(status).toBe(200);
    expect(body.token_type).toBe("Bearer");
    expect(body.expires_in).toBe(600);
    const verified = await verifyAuthBearerToken(body.access_token as string, {
      audience: DEV_REGISTRY,
    });
    expect(verified).not.toBe(false);
    if (verified === false) return;
    expect(verified.issuer).toBe(did);
    expect(verified.verifiableCredential.credentialSubject).toMatchObject({
      address: OWNER,
      chainId: 1,
      networkId: "eip155",
    });
    const expectedExp = Math.floor(Date.now() / 1000) + 600;
    expect(Math.abs(verified.payload.exp! - expectedExp)).toBeLessThanOrEqual(
      5,
    );
    expect(verified.payload.iss).toBe(did);
    expect(verified.payload.vetra).toEqual({
      ref: "refs/pull/42/merge",
      refClass: "PREVIEW",
      sha: "0123456789abcdef0123456789abcdef01234567",
      repository: REPOSITORY,
      repositoryId: REPOSITORY_ID,
      runId: "9876543210",
      runAttempt: "1",
      actor: "octocat",
      prNumber: 42,
    });
    // Bound to the requested audience only.
    expect(
      await verifyAuthBearerToken(body.access_token as string, {
        audience: PROD_REGISTRY,
      }),
    ).toBe(false);
    expect(logs.join()).toContain('"run_id":"9876543210"');
    expect(logs.join()).not.toContain(body.access_token as string);
  });

  it("gives production-branch runs the production registry", async () => {
    const { status, body } = await exchange(
      await githubToken(prClaims({ ref: "refs/heads/main" })),
      PROD_REGISTRY,
    );
    expect(status).toBe(200);
    const verified = await verifyAuthBearerToken(body.access_token as string, {
      audience: PROD_REGISTRY,
    });
    expect(
      verified && (verified.payload.vetra as { refClass: string }).refClass,
    ).toBe("PRODUCTION");
  });

  it("gives v* tag runs a RELEASE token", async () => {
    const { status, body } = await exchange(
      await githubToken(prClaims({ ref: "refs/tags/v1.0.0" })),
      PROD_REGISTRY,
    );
    expect(status).toBe(200);
    const verified = await verifyAuthBearerToken(body.access_token as string, {
      audience: PROD_REGISTRY,
    });
    expect(
      verified && (verified.payload.vetra as { refClass: string }).refClass,
    ).toBe("RELEASE");
  });

  it("refuses a PREVIEW run the production registry (403)", async () => {
    const { status, body } = await exchange(
      await githubToken(prClaims()),
      PROD_REGISTRY,
    );
    expect(status).toBe(403);
    expect(body.error).toBe("access_denied");
  });

  it("refuses an audience outside the allowlist (403)", async () => {
    const { status } = await exchange(
      await githubToken(prClaims({ ref: "refs/heads/main" })),
      "https://evil.example",
    );
    expect(status).toBe(403);
  });

  it.each([
    ["wrong issuer", { issuer: "https://evil.example" }],
    ["wrong audience", { audience: "https://other.example" }],
    ["expired", { expiresIn: -120 }],
    ["bad signature", { forged: true }],
  ])("rejects a GitHub token with %s (401)", async (_name, options) => {
    const { status, body } = await exchange(
      await githubToken(prClaims(), options),
    );
    expect(status).toBe(401);
    expect(body).toEqual({ error: "invalid_token" });
  });

  it("rejects a malformed subject token (401)", async () => {
    expect((await exchange("not-a-jwt")).status).toBe(401);
  });

  it("rejects an unknown repository_id (403)", async () => {
    const { status, body } = await exchange(
      await githubToken(prClaims({ repository_id: "999" })),
    );
    expect(status).toBe(403);
    expect(body.error).toBe("access_denied");
  });

  it("rejects a repository name that doesn't match the identity (403)", async () => {
    const { status } = await exchange(
      await githubToken(prClaims({ repository: "acme/other" })),
    );
    expect(status).toBe(403);
  });

  it.each([
    "refs/heads/feature",
    "refs/heads/dev",
    "refs/tags/release-1",
    "refs/pull/42/head",
  ])("rejects the non-deployable ref %s (403)", async (ref) => {
    const { status } = await exchange(await githubToken(prClaims({ ref })));
    expect(status).toBe(403);
  });

  it("follows the production branch as updated", async () => {
    await deps.store.update(did, { productionBranch: "release" }, new Date());
    expect(
      (await exchange(await githubToken(prClaims({ ref: "refs/heads/main" }))))
        .status,
    ).toBe(403);
    expect(
      (
        await exchange(
          await githubToken(prClaims({ ref: "refs/heads/release" })),
        )
      ).status,
    ).toBe(200);
  });

  it.each([
    ["no body", ""],
    ["invalid JSON", "{"],
    ["no subject_token", JSON.stringify({ audience: DEV_REGISTRY })],
    ["no audience", JSON.stringify({ subject_token: "x" })],
    ["a non-object", "[]"],
  ])("answers 400 invalid_request for %s", async (_name, body) => {
    const res = await createTokenHandler(() => deps)(post(body));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request" });
  });

  it("answers 400 for a non-JSON content type", async () => {
    const res = await createTokenHandler(() => deps)(
      post("subject_token=x", "application/x-www-form-urlencoded"),
    );
    expect(res.status).toBe(400);
  });

  it("answers 503 temporarily_unavailable when unconfigured", async () => {
    const res = await createTokenHandler(() => null)(
      post({ subject_token: "x", audience: DEV_REGISTRY }),
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "temporarily_unavailable" });
  });

  it("answers 503 when GitHub's JWKS is unreachable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const d = {
      ...deps,
      verifier: createGithubVerifier({
        fetchJwks: () => Promise.reject(new Error("down")),
      }),
    };
    expect(
      (await exchange(await githubToken(prClaims()), DEV_REGISTRY, d)).status,
    ).toBe(503);
    vi.restoreAllMocks();
  });

  it("answers 500 (no token) when the stored key can't be decrypted", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const d = { ...deps, encryptionKey: new Uint8Array(32).fill(9) };
    const { status, body } = await exchange(
      await githubToken(prClaims()),
      DEV_REGISTRY,
      d,
    );
    expect(status).toBe(500);
    expect(body.access_token).toBeUndefined();
    vi.restoreAllMocks();
  });
});
