import { verifyAuthBearerToken } from "@renown/sdk";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_AUDIENCES, loadConfig } from "../core/config.js";
import { open, seal } from "../core/crypto.js";
import { createGithubVerifier, GithubTokenError } from "../core/github.js";
import { generateWorkloadKey, issueWorkloadToken } from "../core/keys.js";
import { classifyRef, isAudienceAllowed } from "../core/refs.js";
import { githubJwks, githubToken, prClaims } from "./github-fixture.js";

const KEY = new Uint8Array(32).fill(7);

describe("loadConfig", () => {
  it("disables everything (with reasons) when unset, defaulting the audiences", () => {
    const { config, problems } = loadConfig({});
    expect(config).toEqual({
      encryptionKey: null,
      registrationToken: null,
      audiences: DEFAULT_AUDIENCES,
    });
    expect(problems).toHaveLength(2);
  });

  it("parses a base64 32-byte key, the token and a comma-separated audience list", () => {
    const { config, problems } = loadConfig({
      RENOWN_WORKLOAD_KEY_ENCRYPTION_KEY: Buffer.from(KEY).toString("base64"),
      RENOWN_WORKLOAD_REGISTRATION_TOKEN: "t0ken",
      RENOWN_WORKLOAD_AUDIENCES:
        " https://a.example/ ,https://b.example,,https://a.example",
    });
    expect(problems).toEqual([]);
    expect(config.encryptionKey).toEqual(KEY);
    expect(config.registrationToken).toBe("t0ken");
    expect(config.audiences).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
  });

  it("rejects a key of the wrong length without echoing it", () => {
    const raw = Buffer.from("too-short-key-material").toString("base64");
    const { config, problems } = loadConfig({
      RENOWN_WORKLOAD_KEY_ENCRYPTION_KEY: raw,
    });
    expect(config.encryptionKey).toBeNull();
    expect(problems.join()).toContain("invalid");
    expect(problems.join()).not.toContain(raw);
  });
});

describe("seal/open", () => {
  it("round-trips, and fails with another context or key", async () => {
    const sealed = await seal(KEY, "secret", "did:key:a");
    expect(sealed).not.toContain("secret");
    await expect(open(KEY, sealed, "did:key:a")).resolves.toBe("secret");
    await expect(open(KEY, sealed, "did:key:b")).rejects.toThrow();
    await expect(
      open(new Uint8Array(32), sealed, "did:key:a"),
    ).rejects.toThrow();
    await expect(open(KEY, "garbage", "did:key:a")).rejects.toThrow();
  });
});

describe("classifyRef", () => {
  it.each([
    ["refs/heads/main", { refClass: "PRODUCTION", prNumber: null }],
    ["refs/tags/v1.2.3", { refClass: "RELEASE", prNumber: null }],
    ["refs/pull/42/merge", { refClass: "PREVIEW", prNumber: 42 }],
  ])("%s", (ref, expected) => {
    expect(classifyRef(ref, "main")).toEqual(expected);
  });

  it.each([
    "refs/heads/feature",
    "refs/heads/main-2",
    "refs/heads/mainx",
    "refs/tags/release-1",
    "refs/tags/v",
    "refs/pull/42/head",
    "refs/pull/0/merge",
    "refs/pull/x/merge",
    "main",
  ])("rejects %s", (ref) => {
    expect(classifyRef(ref, "main")).toBeNull();
  });
});

describe("isAudienceAllowed", () => {
  it("allows production and release runs every listed audience", () => {
    for (const audience of DEFAULT_AUDIENCES) {
      expect(isAudienceAllowed("PRODUCTION", audience, DEFAULT_AUDIENCES)).toBe(
        true,
      );
      expect(isAudienceAllowed("RELEASE", audience, DEFAULT_AUDIENCES)).toBe(
        true,
      );
    }
  });

  it("never gives preview runs the production registry, even when listed", () => {
    expect(
      isAudienceAllowed(
        "PREVIEW",
        "https://registry.vetra.io",
        DEFAULT_AUDIENCES,
      ),
    ).toBe(false);
    expect(
      isAudienceAllowed(
        "PREVIEW",
        "https://registry.dev.vetra.io",
        DEFAULT_AUDIENCES,
      ),
    ).toBe(true);
    expect(
      isAudienceAllowed(
        "PREVIEW",
        "https://switchboard.vetra.io",
        DEFAULT_AUDIENCES,
      ),
    ).toBe(true);
  });

  it("rejects audiences outside the allowlist", () => {
    expect(
      isAudienceAllowed(
        "PRODUCTION",
        "https://evil.example",
        DEFAULT_AUDIENCES,
      ),
    ).toBe(false);
  });
});

describe("workload keys", () => {
  it("generates a P-256 did:key and issues an SDK-verifiable bearer token with the vetra claim", async () => {
    const { did, keyPair } = await generateWorkloadKey();
    expect(did).toMatch(/^did:key:zDn/);
    expect(keyPair.privateKey.crv).toBe("P-256");
    const vetra = {
      ref: "refs/heads/main",
      refClass: "PRODUCTION" as const,
      sha: "abc",
      repository: "acme/shop",
      repositoryId: "1",
      runId: "2",
      runAttempt: "1",
      actor: "octocat",
      prNumber: null,
    };
    const token = await issueWorkloadToken({
      keyPair,
      did,
      chainId: 1,
      address: "0x1111111111111111111111111111111111111111",
      audience: "https://registry.dev.vetra.io",
      expiresInSec: 600,
      vetra,
    });
    const verified = await verifyAuthBearerToken(token, {
      audience: "https://registry.dev.vetra.io",
    });
    expect(verified).not.toBe(false);
    if (verified === false) return;
    expect(verified.issuer).toBe(did);
    expect(verified.payload.vetra).toEqual(vetra);
    expect(verified.verifiableCredential.credentialSubject).toMatchObject({
      address: "0x1111111111111111111111111111111111111111",
      chainId: 1,
      networkId: "eip155",
    });
  });

  it("refuses to sign when the key pair doesn't belong to the DID", async () => {
    const a = await generateWorkloadKey();
    const b = await generateWorkloadKey();
    await expect(
      issueWorkloadToken({
        keyPair: a.keyPair,
        did: b.did,
        chainId: 1,
        address: "0x1111111111111111111111111111111111111111",
        audience: "https://x",
        expiresInSec: 600,
        vetra: {} as never,
      }),
    ).rejects.toThrow("does not match");
  });
});

describe("GitHub verifier", () => {
  it("caches the JWKS for an hour", async () => {
    let now = new Date();
    const fetchJwks = vi.fn(githubJwks);
    const verifier = createGithubVerifier({ fetchJwks, now: () => now });
    await verifier.verify(await githubToken(prClaims(), { now }));
    await verifier.verify(await githubToken(prClaims(), { now }));
    expect(fetchJwks).toHaveBeenCalledTimes(1);
    now = new Date(now.getTime() + 3601_000);
    await verifier.verify(await githubToken(prClaims(), { now }));
    expect(fetchJwks).toHaveBeenCalledTimes(2);
  });

  it("reports an unreachable JWKS as unavailable, not invalid", async () => {
    const verifier = createGithubVerifier({
      fetchJwks: () => Promise.reject(new Error("down")),
    });
    const err = await verifier
      .verify(await githubToken(prClaims()))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GithubTokenError);
    expect((err as GithubTokenError).kind).toBe("unavailable");
  });

  it("rejects a token without repository_id", async () => {
    const verifier = createGithubVerifier({ fetchJwks: githubJwks });
    await expect(
      verifier.verify(
        await githubToken(prClaims({ repository_id: undefined })),
      ),
    ).rejects.toThrow("repository_id");
  });
});
