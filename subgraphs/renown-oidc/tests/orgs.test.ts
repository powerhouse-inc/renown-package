/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- untyped Response.json() bodies */
import { createLocalJWKSet, jwtVerify } from "jose";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildClaims, isSubjectAllowedByOrgs } from "../core/claims.js";
import { loadSigningKeys } from "../core/keys.js";
import type { OidcClient, OrgClaim } from "../core/types.js";
import { createOidcHandlers } from "../http/handlers.js";
import { registerClient, updateClient, type ClientRegistryDeps } from "../register.js";
import { MemoryOidcStore } from "../store/memory.js";
import { testSigningKeysEnv } from "./signing-key.js";

const issuer = "https://sb.example/api/@powerhousedao/renown-package/oidc";
const config = { issuer, loginUrl: "https://renown.example/oidc/login", registrationToken: null, driveId: null };
const member = privateKeyToAccount(generatePrivateKey());
const outsider = privateKeyToAccount(generatePrivateKey());
const ACME: OrgClaim = { id: "o1", did: "did:web:renown.test:org:o1", handle: "acme", name: "Acme", role: "PUBLISHER", teams: ["core"], verifiedDomains: ["acme.example"] };
const REDIRECT = "https://s.example/auth/oidc/callback";
let h: ReturnType<typeof createOidcHandlers>;
let keys: NonNullable<Awaited<ReturnType<typeof loadSigningKeys>>>;

const client: OidcClient = {
  id: "internal",
  name: "Acme wiki",
  redirectUris: [REDIRECT],
  allowedSubjects: [],
  allowAnySubject: false,
  clientSecretHash: null,
  status: "ACTIVE",
  allowedOrgs: [{ orgId: "o1", minRole: "PUBLISHER" }],
};

beforeEach(async () => {
  keys = (await loadSigningKeys(await testSigningKeysEnv(), issuer))!;
  h = createOidcHandlers({
    config,
    keys,
    store: new MemoryOidcStore(),
    clients: { getClient: (id) => Promise.resolve(id === client.id ? client : undefined) },
    profiles: { getProfile: () => Promise.resolve(undefined) },
    orgs: { orgsOf: (address) => Promise.resolve(address.toLowerCase() === member.address.toLowerCase() ? [ACME] : []) },
    now: () => new Date(),
  });
});

async function login(account: typeof member, scope: string) {
  const q = new URLSearchParams({ client_id: client.id, redirect_uri: REDIRECT, response_type: "code", scope, state: "s", nonce: "n", code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", code_challenge_method: "S256" });
  const a = await h.authorize(new Request(`${issuer}/authorize?${q}`));
  const id = new URL(a.headers.get("location")!).searchParams.get("request")!;
  const t = (await (await h.interaction(new Request(`${issuer}/interaction/${id}`), id)).json()).siwe;
  const message = createSiweMessage({ address: account.address, chainId: 1, domain: t.domain, uri: t.uri, version: "1", nonce: t.nonce, issuedAt: new Date(t.issuedAt), expirationTime: new Date(t.expirationTime), statement: t.statement, requestId: t.requestId, resources: t.resources });
  const signature = await account.signMessage({ message });
  return h.complete(new Request(`${issuer}/interaction/${id}/complete`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, signature }) }), id);
}

describe("OIDC orgs", () => {
  it("advertises the orgs scope and claim", async () => {
    const d = await (await h.discovery(new Request(`${issuer}/.well-known/openid-configuration`))).json();
    expect(d.scopes_supported).toEqual(["openid", "profile", "email", "orgs"]);
    expect(d.claims_supported).toContain("orgs");
  });

  it("lets members of an allowed org (at or above minRole) sign in, and puts orgs in the id_token", async () => {
    expect((await login(outsider, "openid orgs")).status).toBe(403);
    const r = await login(member, "openid orgs");
    expect(r.status).toBe(200);
    const code = new URL((await r.json()).redirect).searchParams.get("code")!;
    const token = await h.token(new Request(`${issuer}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: client.id, code_verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk" }),
    }));
    const body = await token.json();
    const { payload } = await jwtVerify(body.id_token, createLocalJWKSet(keys.jwks() as never), { issuer, audience: client.id });
    expect(payload.orgs).toEqual([ACME]);
    const info = await (await h.userinfo(new Request(`${issuer}/userinfo`, { headers: { authorization: `Bearer ${body.access_token}` } }))).json();
    expect(info.orgs).toEqual([ACME]);
  });

  it("builds the claim only for the orgs scope, and checks minRole", () => {
    const address = member.address;
    expect(buildClaims(address, undefined, "openid", [ACME])).not.toHaveProperty("orgs");
    expect(buildClaims(address, undefined, "openid orgs", [ACME]).orgs).toEqual([ACME]);
    expect(buildClaims(address, undefined, "openid orgs").orgs).toEqual([]);
    expect(isSubjectAllowedByOrgs(client, [ACME])).toBe(true);
    expect(isSubjectAllowedByOrgs(client, [{ ...ACME, role: "MEMBER" }])).toBe(false);
    expect(isSubjectAllowedByOrgs(client, [{ ...ACME, id: "o2", role: "OWNER" }])).toBe(false);
    expect(isSubjectAllowedByOrgs({ ...client, allowedOrgs: undefined }, [ACME])).toBe(false);
  });
});

describe("registry allowedOrgs", () => {
  function registry(): ClientRegistryDeps & { store: MemoryOidcStore } {
    return {
      store: new MemoryOidcStore(),
      driveId: null,
      now: () => new Date("2026-10-12T12:00:00Z"),
      log: () => undefined,
      reactorClient: {
        createEmpty: (() => Promise.resolve({ header: { id: "doc-1" } })) as never,
        execute: ((id: string) => Promise.resolve({ header: { id }, operations: { global: [] } })) as never,
      },
    };
  }

  it("stores, replaces and validates allowedOrgs", async () => {
    const deps = registry();
    const { clientId } = await registerClient(deps, { name: "Wiki", redirectUris: [REDIRECT], allowedSubjects: [], confidential: false, allowedOrgs: [{ orgId: "o1", minRole: "member" as never }] });
    expect((await deps.store.getClient(clientId))?.allowedOrgs).toEqual([{ orgId: "o1", minRole: "MEMBER" }]);
    await updateClient(deps, clientId, { allowedOrgs: [{ orgId: "o2", minRole: "ADMIN" }] });
    expect((await deps.store.getClient(clientId))?.allowedOrgs).toEqual([{ orgId: "o2", minRole: "ADMIN" }]);
    await expect(updateClient(deps, clientId, { allowedOrgs: [{ orgId: "o2", minRole: "ROOT" as never }] })).rejects.toThrow(/minRole/);
    await expect(updateClient(deps, clientId, { allowedOrgs: [{ orgId: " ", minRole: "ADMIN" }] })).rejects.toThrow(/orgId/);
    await updateClient(deps, clientId, { allowedOrgs: [] });
    expect((await deps.store.getClient(clientId))?.allowedOrgs).toBeUndefined();
  });
});

describe("orgs lookup failures and stored rows", () => {
  it("logs a warning and issues an empty claim when the directory fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const failing = createOidcHandlers({
      config,
      keys,
      store: new MemoryOidcStore(),
      clients: { getClient: () => Promise.resolve(client) },
      profiles: { getProfile: () => Promise.resolve(undefined) },
      orgs: { orgsOf: () => Promise.reject(new Error("db down")) },
      now: () => new Date(),
    });
    expect((await failing.userinfo(new Request(`${issuer}/userinfo`, { headers: { authorization: "Bearer nope" } }))).status).toBe(401);
    // Drive the fallback through login: a non-allowed subject is refused, with the failure logged.
    h = failing;
    expect((await login(member, "openid orgs")).status).toBe(403);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("db down"));
    warn.mockRestore();
  });
});
