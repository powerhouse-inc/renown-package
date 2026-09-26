/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- untyped Response.json() bodies */
import { describe, expect, it, beforeEach } from "vitest";
import { jwtVerify, createLocalJWKSet } from "jose";
import { createSiweMessage } from "viem/siwe";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { getAddress } from "viem";
import { createOidcHandlers } from "../http/handlers.js";
import { htmlError } from "../http/errors.js";
import { MemoryOidcStore } from "../store/memory.js";
import { loadSigningKeys } from "../core/keys.js";
import { hashSecret, sha256B64url } from "../core/crypto.js";
import type { OidcClient } from "../core/types.js";
import { testSigningKeysEnv } from "./signing-key.js";

const issuer = "https://sb.example/api/@powerhousedao/renown-package/oidc";
const config = { issuer, loginUrl: "https://renown.example/oidc/login", registrationToken: null, driveId: null };
const user = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());
let clock = new Date("2026-09-26T12:00:00Z");
let h: ReturnType<typeof createOidcHandlers>;
const SECRET = "s3cr3t-s3cr3t-s3cr3t";
let confidential: OidcClient, publicClient: OidcClient;

beforeEach(async () => {
  clock = new Date("2026-09-26T12:00:00Z");
  const keys = (await loadSigningKeys(await testSigningKeysEnv(), issuer))!;
  confidential = { id: "conf", name: "Speckle", redirectUris: ["https://s.example/auth/oidc/callback"], allowedSubjects: [user.address.toLowerCase()], allowAnySubject: false, clientSecretHash: await hashSecret(SECRET), status: "ACTIVE" };
  publicClient = { ...confidential, id: "pub", clientSecretHash: null };
  const clients = new Map([[confidential.id, confidential], [publicClient.id, publicClient]]);
  h = createOidcHandlers({ config, keys, store: new MemoryOidcStore(), clients: { getClient: async (id) => clients.get(id) }, profiles: { getProfile: async () => ({ username: "frank", userImage: null }) }, now: () => clock });
});

async function login(clientId: string, account = user, extra: Record<string, string> = {}) {
  const q = new URLSearchParams({ client_id: clientId, redirect_uri: "https://s.example/auth/oidc/callback", response_type: "code", scope: "openid profile email", state: "st8", nonce: "nn", ...extra });
  const a = await h.authorize(new Request(`${issuer}/authorize?${q}`));
  expect(a.status).toBe(302);
  const id = new URL(a.headers.get("location")!).searchParams.get("request")!;
  const i = await (await h.interaction(new Request(`${issuer}/interaction/${id}`), id)).json();
  const t = i.siwe;
  const message = createSiweMessage({ address: account.address, chainId: 1, domain: t.domain, uri: t.uri, version: "1", nonce: t.nonce, issuedAt: new Date(t.issuedAt), expirationTime: new Date(t.expirationTime), statement: t.statement, requestId: t.requestId, resources: t.resources });
  const signature = await account.signMessage({ message });
  return h.complete(new Request(`${issuer}/interaction/${id}/complete`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, signature }) }), id);
}
const codeOf = async (r: Response) => new URL((await r.json()).redirect).searchParams.get("code")!;
const tokenReq = (form: Record<string, string>, basic?: string) => new Request(`${issuer}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...(basic ? { authorization: `Basic ${btoa(basic)}` } : {}) }, body: new URLSearchParams(form) });

describe("OIDC flow", () => {
  it("discovery and jwks", async () => {
    const d = await (await h.discovery(new Request(`${issuer}/.well-known/openid-configuration`))).json();
    expect(d).toMatchObject({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`, code_challenge_methods_supported: ["S256"], id_token_signing_alg_values_supported: ["RS256"] });
    const j = await (await h.jwks(new Request(`${issuer}/jwks`))).json();
    expect(j.keys[0]).toMatchObject({ kty: "RSA", alg: "RS256", use: "sig", kid: "k1" });
    expect(j.keys[0]).not.toHaveProperty("d");
  });

  it("confidential client: code → id_token → userinfo", async () => {
    const r = await login("conf"); expect(r.status).toBe(200);
    const body = await r.clone().json(); expect(body.redirect).toContain("state=st8");
    const code = await codeOf(r);
    const t = await h.token(tokenReq({ grant_type: "authorization_code", code, redirect_uri: "https://s.example/auth/oidc/callback" }, `conf:${SECRET}`));
    expect(t.status).toBe(200); expect(t.headers.get("cache-control")).toBe("no-store");
    const tok = await t.json();
    const jwks = await (await h.jwks(new Request(`${issuer}/jwks`))).json();
    const { payload } = await jwtVerify(tok.id_token, createLocalJWKSet(jwks), { issuer, audience: "conf" });
    expect(payload).toMatchObject({ sub: `did:pkh:eip155:1:${getAddress(user.address)}`, nonce: "nn", name: "frank", email: `${user.address.toLowerCase()}@renown.vetra.io`, email_verified: false });
    const u = await h.userinfo(new Request(`${issuer}/userinfo`, { headers: { authorization: `Bearer ${tok.access_token}` } }));
    expect((await u.json()).sub).toBe(payload.sub);
  });

  it("replayed code fails and revokes the first access token", async () => {
    const code = await codeOf(await login("conf"));
    const first = await (await h.token(tokenReq({ grant_type: "authorization_code", code, redirect_uri: "https://s.example/auth/oidc/callback", client_id: "conf", client_secret: SECRET }))).json();
    const again = await h.token(tokenReq({ grant_type: "authorization_code", code, redirect_uri: "https://s.example/auth/oidc/callback", client_id: "conf", client_secret: SECRET }));
    expect(again.status).toBe(400); expect((await again.json()).error).toBe("invalid_grant");
    const u = await h.userinfo(new Request(`${issuer}/userinfo`, { headers: { authorization: `Bearer ${first.access_token}` } }));
    expect(u.status).toBe(401);
  });

  it("expired code is invalid_grant", async () => {
    const code = await codeOf(await login("conf"));
    clock = new Date(clock.getTime() + 61_000);
    const r = await h.token(tokenReq({ grant_type: "authorization_code", code, redirect_uri: "https://s.example/auth/oidc/callback" }, `conf:${SECRET}`));
    expect((await r.json()).error).toBe("invalid_grant");
  });

  it("wrong secret is invalid_client (401)", async () => {
    const code = await codeOf(await login("conf"));
    const r = await h.token(tokenReq({ grant_type: "authorization_code", code, redirect_uri: "https://s.example/auth/oidc/callback" }, "conf:nope"));
    expect(r.status).toBe(401); expect((await r.json()).error).toBe("invalid_client");
  });

  it("public client requires PKCE and a matching verifier", async () => {
    const q = new URLSearchParams({ client_id: "pub", redirect_uri: "https://s.example/auth/oidc/callback", response_type: "code", scope: "openid", state: "x" });
    const noPkce = await h.authorize(new Request(`${issuer}/authorize?${q}`));
    expect(new URL(noPkce.headers.get("location")!).searchParams.get("error")).toBe("invalid_request");
    const verifier = "a".repeat(64);
    const code = await codeOf(await login("pub", user, { code_challenge: await sha256B64url(verifier), code_challenge_method: "S256" }));
    const bad = await h.token(tokenReq({ grant_type: "authorization_code", code, redirect_uri: "https://s.example/auth/oidc/callback", client_id: "pub", code_verifier: "b".repeat(64) }));
    expect((await bad.json()).error).toBe("invalid_grant");
  });

  it("disallowed subject gets access_denied and no code", async () => {
    const r = await login("conf", stranger);
    expect(r.status).toBe(403); expect((await r.json()).error).toBe("access_denied");
  });

  it("unknown client, disabled client and unregistered redirect never redirect", async () => {
    for (const [cid, redirect] of [["nope", "https://s.example/auth/oidc/callback"], ["conf", "https://s.example/auth/oidc/callback/"], ["conf", "https://evil.example/cb"]]) {
      const q = new URLSearchParams({ client_id: cid, redirect_uri: redirect, response_type: "code", scope: "openid" });
      const r = await h.authorize(new Request(`${issuer}/authorize?${q}`));
      expect(r.status).toBe(400); expect(r.headers.get("location")).toBeNull();
    }
    confidential.status = "DISABLED";
    const q = new URLSearchParams({ client_id: "conf", redirect_uri: "https://s.example/auth/oidc/callback", response_type: "code", scope: "openid" });
    expect((await h.authorize(new Request(`${issuer}/authorize?${q}`))).status).toBe(400);
  });

  it("signature for another request is rejected", async () => {
    const q = new URLSearchParams({ client_id: "conf", redirect_uri: "https://s.example/auth/oidc/callback", response_type: "code", scope: "openid" });
    const ids = [];
    for (let n = 0; n < 2; n++) ids.push(new URL((await h.authorize(new Request(`${issuer}/authorize?${q}`))).headers.get("location")!).searchParams.get("request")!);
    const t = (await (await h.interaction(new Request(`${issuer}/interaction/${ids[0]}`), ids[0])).json()).siwe;
    const message = createSiweMessage({ address: user.address, chainId: 1, domain: t.domain, uri: t.uri, version: "1", nonce: t.nonce, issuedAt: new Date(t.issuedAt), expirationTime: new Date(t.expirationTime), statement: t.statement, requestId: t.requestId, resources: t.resources });
    const signature = await user.signMessage({ message });
    const r = await h.complete(new Request("https://x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, signature }) }), ids[1]);
    expect(r.status).toBe(403);
  });
});

describe("OIDC hardening", () => {
  const cb = "https://s.example/auth/oidc/callback";

  it("a login request is single-use", async () => {
    const q = new URLSearchParams({ client_id: "conf", redirect_uri: cb, response_type: "code", scope: "openid" });
    const id = new URL((await h.authorize(new Request(`${issuer}/authorize?${q}`))).headers.get("location")!).searchParams.get("request")!;
    const t = (await (await h.interaction(new Request(`${issuer}/interaction/${id}`), id)).json()).siwe;
    const message = createSiweMessage({ address: user.address, chainId: 1, domain: t.domain, uri: t.uri, version: "1", nonce: t.nonce, issuedAt: new Date(t.issuedAt), expirationTime: new Date(t.expirationTime), statement: t.statement, requestId: t.requestId, resources: t.resources });
    const signature = await user.signMessage({ message });
    const post = () => h.complete(new Request("https://x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, signature }) }), id);
    expect((await post()).status).toBe(200);
    expect((await post()).status).toBe(404);
    expect((await h.interaction(new Request("https://x"), id)).status).toBe(404);
  });

  it("expired login request is 404", async () => {
    const q = new URLSearchParams({ client_id: "conf", redirect_uri: cb, response_type: "code", scope: "openid" });
    const id = new URL((await h.authorize(new Request(`${issuer}/authorize?${q}`))).headers.get("location")!).searchParams.get("request")!;
    clock = new Date(clock.getTime() + 600_000);
    expect((await h.interaction(new Request("https://x"), id)).status).toBe(404);
  });

  it("Basic and form credentials together are invalid_request", async () => {
    const code = await codeOf(await login("conf"));
    const r = await h.token(tokenReq({ grant_type: "authorization_code", code, redirect_uri: cb, client_secret: SECRET }, `conf:${SECRET}`));
    expect(r.status).toBe(400); expect((await r.json()).error).toBe("invalid_request");
  });

  it("Basic credentials are URL-decoded (RFC 6749 §2.3.1)", async () => {
    const code = await codeOf(await login("conf"));
    const r = await h.token(tokenReq({ grant_type: "authorization_code", code, redirect_uri: cb }, `${encodeURIComponent("conf")}:${encodeURIComponent(SECRET).replace(/-/g, "%2D")}`));
    expect(r.status).toBe(200);
  });

  it("unknown client with Basic is 401 with WWW-Authenticate", async () => {
    const r = await h.token(tokenReq({ grant_type: "authorization_code", code: "x", redirect_uri: cb }, "ghost:whatever"));
    expect(r.status).toBe(401); expect(r.headers.get("www-authenticate")).toBe("Basic");
  });

  it("expired access token is rejected at userinfo", async () => {
    const code = await codeOf(await login("conf"));
    const tok = await (await h.token(tokenReq({ grant_type: "authorization_code", code, redirect_uri: cb }, `conf:${SECRET}`))).json();
    clock = new Date(clock.getTime() + 3600_000);
    const u = await h.userinfo(new Request(`${issuer}/userinfo`, { headers: { authorization: `Bearer ${tok.access_token}` } }));
    expect(u.status).toBe(401); expect(u.headers.get("www-authenticate")).toBe('Bearer error="invalid_token"');
  });

  it("redirect errors append to an existing query and keep state", async () => {
    const withQuery = "https://s.example/cb?tenant=a";
    confidential.redirectUris.push(withQuery);
    const q = new URLSearchParams({ client_id: "conf", redirect_uri: withQuery, response_type: "token", scope: "openid", state: "s1" });
    const loc = new URL((await h.authorize(new Request(`${issuer}/authorize?${q}`))).headers.get("location")!);
    expect(loc.searchParams.get("tenant")).toBe("a");
    expect(loc.searchParams.get("error")).toBe("unsupported_response_type");
    expect(loc.searchParams.get("state")).toBe("s1");
  });

  it("the HTML error page escapes its content and authorize reflects no input", async () => {
    const page = await htmlError(400, "<b>t</b>", `"'&<img src=x>`).text();
    expect(page).toContain("&lt;b&gt;t&lt;/b&gt;"); expect(page).toContain("&quot;&#39;&amp;&lt;img src=x&gt;"); expect(page).not.toContain("<img");
    const q = new URLSearchParams({ client_id: "<script>alert(1)</script>", redirect_uri: cb, response_type: "code", scope: "openid" });
    const r = await h.authorize(new Request(`${issuer}/authorize?${q}`));
    expect(r.status).toBe(400); expect(await r.text()).not.toContain("<script>");
  });
});
