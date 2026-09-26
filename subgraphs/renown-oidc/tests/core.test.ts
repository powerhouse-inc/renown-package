import { describe, expect, it } from "vitest";
import { generateKeyPair, exportJWK, importJWK, jwtVerify, createLocalJWKSet } from "jose";
import { createSiweMessage } from "viem/siwe";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { getAddress } from "viem";
import { randomToken, sha256Hex, hashSecret, constantTimeEqual } from "../core/crypto.js";
import { verifyPkceS256 } from "../core/pkce.js";
import { loadConfig } from "../core/config.js";
import { loadSigningKeys } from "../core/keys.js";
import { buildSiweTemplate, verifySiweLogin } from "../core/siwe.js";
import { subjectFor, isSubjectAllowed, buildClaims, OidcError } from "../core/claims.js";
import type { LoginRequest, OidcClient } from "../core/types.js";

const cfg = { issuer: "https://sb.example/api/@powerhousedao/renown-package/oidc", loginUrl: "https://renown.example/oidc/login", registrationToken: null, driveId: null };
const client: OidcClient = { id: "c1", name: "Speckle", redirectUris: ["https://s.example/cb"], allowedSubjects: [], allowAnySubject: false, clientSecretHash: null, status: "ACTIVE" };
const now = new Date("2026-09-26T12:00:00Z");
const req: LoginRequest = { id: "req1", clientId: "c1", redirectUri: "https://s.example/cb", scope: "openid email", state: "st", nonce: "n", codeChallenge: null, siweNonce: "abcdefgh12345678", expiresAt: new Date(now.getTime() + 600_000) };

async function sign(account: ReturnType<typeof privateKeyToAccount>, t: ReturnType<typeof buildSiweTemplate>, over: Partial<Parameters<typeof createSiweMessage>[0]> = {}) {
  const message = createSiweMessage({ address: account.address, chainId: 1, domain: t.domain, uri: t.uri, version: "1", nonce: t.nonce, issuedAt: new Date(t.issuedAt), expirationTime: new Date(t.expirationTime), statement: t.statement, requestId: t.requestId, resources: t.resources, ...over });
  return { message, signature: await account.signMessage({ message }) };
}

describe("crypto", () => {
  it("random tokens are base64url and distinct", () => {
    const a = randomToken(); expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(randomToken()).not.toBe(a);
  });
  it("hashes", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(await hashSecret("abc")).toBe("sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(constantTimeEqual("a", "a")).toBe(true); expect(constantTimeEqual("a", "b")).toBe(false); expect(constantTimeEqual("a", "ab")).toBe(false);
  });
});

describe("pkce", () => {
  it("verifies RFC 7636 appendix B", async () => {
    expect(await verifyPkceS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")).toBe(true);
    expect(await verifyPkceS256("wrong", "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")).toBe(false);
  });
});

describe("config", () => {
  it("defaults issuer from the http base url and login url", () => {
    const c = loadConfig({}, "https://sb.example/api/@powerhousedao/renown-package");
    expect(c.issuer).toBe("https://sb.example/api/@powerhousedao/renown-package/oidc");
    expect(c.loginUrl).toBe("https://renown.vetra.io/oidc/login");
    expect(c.registrationToken).toBeNull();
  });
  it("honours overrides and strips trailing slashes", () => {
    const c = loadConfig({ RENOWN_OIDC_ISSUER: "https://auth.vetra.io/", RENOWN_OIDC_LOGIN_URL: "https://r/x", RENOWN_OIDC_REGISTRATION_TOKEN: "t", RENOWN_OIDC_DRIVE_ID: "d" }, "https://ignored");
    expect(c).toEqual({ issuer: "https://auth.vetra.io", loginUrl: "https://r/x", registrationToken: "t", driveId: "d" });
  });
});

describe("keys", () => {
  it("returns null when unset and signs verifiable ES256 tokens with the first key", async () => {
    expect(await loadSigningKeys(undefined, cfg.issuer)).toBeNull();
    const { privateKey } = await generateKeyPair("ES256", { extractable: true });
    const jwk = { ...(await exportJWK(privateKey)), kid: "k1" };
    const keys = (await loadSigningKeys(JSON.stringify([jwk]), cfg.issuer))!;
    const pub = keys.jwks().keys[0];
    expect(pub).toMatchObject({ kid: "k1", kty: "EC", crv: "P-256", alg: "ES256", use: "sig" });
    expect(pub).not.toHaveProperty("d");
    const token = await keys.sign({ sub: "s" }, { audience: "c1", expiresInSec: 600 });
    const { payload, protectedHeader } = await jwtVerify(token, createLocalJWKSet(keys.jwks() as never), { issuer: cfg.issuer, audience: "c1" });
    expect(protectedHeader).toMatchObject({ alg: "ES256", kid: "k1" }); expect(payload.sub).toBe("s");
  });
  it("rejects keys without kid or non-EC keys", async () => {
    await expect(loadSigningKeys(JSON.stringify([{ kty: "oct", k: "x" }]), cfg.issuer)).rejects.toThrow();
  });
  it("publishes an allowlisted, importable JWKS entry even when the source JWK carries key_ops/ext", async () => {
    const { privateKey } = await generateKeyPair("ES256", { extractable: true });
    const rawJwk = await exportJWK(privateKey);
    const jwk = { ...rawJwk, kid: "k2", key_ops: ["sign"], ext: true };
    const keys = (await loadSigningKeys(JSON.stringify([jwk]), cfg.issuer))!;
    const pub = keys.jwks().keys[0];
    expect(Object.keys(pub).sort()).toEqual(["alg", "crv", "kid", "kty", "use", "x", "y"]);
    await expect(importJWK(pub as never, "ES256")).resolves.toBeDefined();
  });
  it("does not leak the raw value when RENOWN_OIDC_SIGNING_KEYS is invalid JSON", async () => {
    const raw = "{not-json:::supersecret";
    let caught: unknown;
    try {
      await loadSigningKeys(raw, cfg.issuer);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).not.toContain("supersecret");
  });
});

describe("siwe", () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const t = buildSiweTemplate(req, client, cfg, now);
  it("builds a template bound to the request", () => {
    expect(t).toMatchObject({ domain: "renown.example", uri: cfg.issuer, version: "1", nonce: req.siweNonce, requestId: "req1", resources: ["urn:renown-oidc:request:req1"] });
    expect(t.statement).toContain("Speckle");
    expect(new Date(t.expirationTime).getTime()).toBe(req.expiresAt.getTime());
  });
  it("accepts a correct signature", async () => {
    const { message, signature } = await sign(account, t);
    await expect(verifySiweLogin(message, signature, t, now)).resolves.toEqual({ address: account.address, chainId: 1 });
  });
  it("rejects another request id, nonce, domain, expiry or a forged signature", async () => {
    for (const over of [{ requestId: "other" }, { nonce: "zzzzzzzzzzzzzzzz" }, { domain: "evil.example" }, { expirationTime: new Date(now.getTime() - 1) }]) {
      const { message, signature } = await sign(account, t, over as never);
      const rejection = verifySiweLogin(message, signature, t, now);
      await expect(rejection).rejects.toBeInstanceOf(OidcError);
      await expect(rejection).rejects.toMatchObject({ code: "access_denied", status: 403 });
    }
    const other = privateKeyToAccount(generatePrivateKey());
    const { message } = await sign(account, t);
    const forged = await other.signMessage({ message });
    const forgedRejection = verifySiweLogin(message, forged, t, now);
    await expect(forgedRejection).rejects.toBeInstanceOf(OidcError);
    await expect(forgedRejection).rejects.toMatchObject({ code: "access_denied", status: 403 });
  });
  it("rejects a structurally malformed signature with access_denied/403", async () => {
    const { message } = await sign(account, t);
    const rejection = verifySiweLogin(message, "0x1234", t, now);
    await expect(rejection).rejects.toBeInstanceOf(OidcError);
    await expect(rejection).rejects.toMatchObject({ code: "access_denied", status: 403 });
  });
});

describe("claims", () => {
  const a = "0xabc0000000000000000000000000000000000001";
  it("subject is a checksummed did:pkh", () => {
    expect(subjectFor(a, 1)).toBe(`did:pkh:eip155:1:${getAddress(a)}`);
  });
  it("allowed subjects", () => {
    expect(isSubjectAllowed({ ...client, allowedSubjects: [a] }, a.toUpperCase().replace("0X", "0x"))).toBe(true);
    expect(isSubjectAllowed(client, a)).toBe(false);
    expect(isSubjectAllowed({ ...client, allowAnySubject: true }, a)).toBe(true);
  });
  it("claims by scope", () => {
    const c = buildClaims(a, 1, { username: "frank", userImage: "https://i/x.png" }, "openid profile email");
    expect(c).toMatchObject({ name: "frank", preferred_username: "frank", picture: "https://i/x.png", email: `${a}@renown.vetra.io`, email_verified: false });
    const bare = buildClaims(a, 1, undefined, "openid");
    expect(bare).not.toHaveProperty("email"); expect(bare).not.toHaveProperty("name");
    expect(buildClaims(a, 1, undefined, "openid profile").name).toBe("0xabc0…0001");
  });
});
