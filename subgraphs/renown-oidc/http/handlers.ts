import { buildClaims, isSubjectAllowed, OidcError, subjectFor } from "../core/claims.js";
import { constantTimeEqual, hashSecret, randomToken, sha256Hex } from "../core/crypto.js";
import { verifyPkceS256 } from "../core/pkce.js";
import { buildSiweTemplate, verifySiweLogin } from "../core/siwe.js";
import type { LoginRequest, OidcClient } from "../core/types.js";
import type { OidcDeps } from "./deps.js";
import { appendQuery, htmlError, jsonError, redirectError } from "./errors.js";

const LOGIN_REQUEST_TTL_MS = 10 * 60 * 1000;
const AUTH_CODE_TTL_MS = 60 * 1000;
const ACCESS_TOKEN_TTL_SEC = 3600;
const ID_TOKEN_TTL_SEC = 600;

const SUPPORTED_SCOPES = ["openid", "profile", "email"];

const DISCOVERY_CACHE = "public, max-age=300";

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** The single value of `name`, `undefined` when absent, or `null` when repeated (RFC 6749 §3.1). */
function single(params: URLSearchParams, name: string): string | undefined | null {
  const values = params.getAll(name);
  if (values.length === 0) return undefined;
  if (values.length > 1) return null;
  return values[0];
}

/**
 * A SIWE nonce: EIP-4361 requires it to be alphanumeric (and >= 8 chars), so
 * base64url tokens (which may contain `-`/`_`) are not usable. 12 random
 * bytes as hex = 96 bits of entropy, 24 characters.
 */
function randomSiweNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function isExpired(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() <= now.getTime();
}

function isActive(client: OidcClient | undefined): client is OidcClient {
  return client !== undefined && client.status === "ACTIVE";
}

/**
 * The authorization request's parameters: the query string for GET, the
 * form body for POST (OIDC Core §3.1.2.1 requires both).
 */
async function authorizationParams(req: Request): Promise<URLSearchParams | Response> {
  if (req.method !== "POST") return new URL(req.url).searchParams;
  const contentType = req.headers.get("content-type") ?? "";
  if (!/^application\/x-www-form-urlencoded\b/i.test(contentType)) {
    return htmlError(400, "Invalid request", "The authorization request body must be application/x-www-form-urlencoded.");
  }
  return new URLSearchParams(await req.text());
}

interface ClientCredentials {
  clientId: string;
  clientSecret: string | undefined;
  usedBasic: boolean;
}

/**
 * Extracts client credentials from HTTP Basic (RFC 6749 §2.3.1: each part is
 * form-urlencoded before base64) or from the form body. Returns an error
 * Response when they are malformed or supplied through both channels.
 */
function readClientCredentials(req: Request, form: URLSearchParams): ClientCredentials | Response {
  const formClientId = single(form, "client_id");
  const formSecret = single(form, "client_secret");
  if (formClientId === null || formSecret === null) {
    return jsonError(400, "invalid_request", "Repeated client credential parameter");
  }

  const authorization = req.headers.get("authorization");
  if (authorization !== null && /^basic\s/i.test(authorization)) {
    if (formSecret !== undefined) {
      return jsonError(400, "invalid_request", "Client credentials supplied in more than one way");
    }
    let clientId: string;
    let clientSecret: string;
    try {
      const decoded = atob(authorization.replace(/^basic\s+/i, "").trim());
      const colon = decoded.indexOf(":");
      if (colon === -1) throw new Error("no separator");
      clientId = decodeURIComponent(decoded.slice(0, colon).replace(/\+/g, " "));
      clientSecret = decodeURIComponent(decoded.slice(colon + 1).replace(/\+/g, " "));
    } catch {
      return jsonError(401, "invalid_client", "Malformed Basic credentials", { "www-authenticate": "Basic" });
    }
    if (formClientId !== undefined && formClientId !== clientId) {
      return jsonError(400, "invalid_request", "client_id does not match the Basic credentials");
    }
    return { clientId, clientSecret, usedBasic: true };
  }

  if (formClientId === undefined || formClientId.length === 0) {
    return jsonError(401, "invalid_client", "Client authentication required");
  }
  return { clientId: formClientId, clientSecret: formSecret, usedBasic: false };
}

export function createOidcHandlers(deps: OidcDeps) {
  const { config, keys, store, clients, profiles } = deps;

  /** The login request and its (still active) client, or undefined when unusable. */
  async function activeLoginRequest(
    id: string,
  ): Promise<{ loginRequest: LoginRequest; client: OidcClient } | undefined> {
    const loginRequest = await store.getLoginRequest(id);
    if (!loginRequest || isExpired(loginRequest.expiresAt, deps.now())) return undefined;
    const client = await clients.getClient(loginRequest.clientId);
    if (!isActive(client)) return undefined;
    return { loginRequest, client };
  }

  return {
    discovery(_req: Request): Promise<Response> {
      const { issuer } = config;
      return Promise.resolve(
        json(
          {
            issuer,
            authorization_endpoint: `${issuer}/authorize`,
            token_endpoint: `${issuer}/token`,
            userinfo_endpoint: `${issuer}/userinfo`,
            jwks_uri: `${issuer}/jwks`,
            response_types_supported: ["code"],
            response_modes_supported: ["query"],
            grant_types_supported: ["authorization_code"],
            subject_types_supported: ["public"],
            id_token_signing_alg_values_supported: ["RS256"],
            scopes_supported: SUPPORTED_SCOPES,
            token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
            code_challenge_methods_supported: ["S256"],
            request_parameter_supported: false,
            claims_parameter_supported: false,
            claims_supported: [
              "sub",
              "name",
              "preferred_username",
              "picture",
              "email",
              "email_verified",
              "nonce",
              "auth_time",
            ],
          },
          200,
          { "cache-control": DISCOVERY_CACHE },
        ),
      );
    },

    jwks(_req: Request): Promise<Response> {
      return Promise.resolve(json(keys.jwks(), 200, { "cache-control": DISCOVERY_CACHE }));
    },

    async authorize(req: Request): Promise<Response> {
      const q = await authorizationParams(req);
      if (q instanceof Response) return q;

      // Until client_id and redirect_uri are validated, nothing may redirect.
      const clientId = single(q, "client_id");
      const redirectUri = single(q, "redirect_uri");
      if (!clientId || !redirectUri) {
        return htmlError(400, "Invalid request", "The request is missing a valid client_id or redirect_uri.");
      }
      const client = await clients.getClient(clientId);
      if (!isActive(client)) {
        return htmlError(400, "Unknown client", "This application is not registered or has been disabled.");
      }
      if (!client.redirectUris.includes(redirectUri)) {
        return htmlError(400, "Invalid redirect URI", "The redirect_uri is not registered for this application.");
      }

      const rawState = single(q, "state");
      const state = typeof rawState === "string" && rawState.length > 0 ? rawState : null;
      const fail = (error: string, description: string) => redirectError(redirectUri, error, description, state);

      const names = ["state", "response_type", "scope", "nonce", "code_challenge", "code_challenge_method"];
      if (names.some((name) => single(q, name) === null)) {
        return fail("invalid_request", "A parameter was repeated");
      }

      if (single(q, "response_type") !== "code") {
        return fail("unsupported_response_type", "Only response_type=code is supported");
      }
      const requested = (single(q, "scope") ?? "").split(/\s+/).filter(Boolean);
      if (!requested.includes("openid")) {
        return fail("invalid_scope", "The openid scope is required");
      }
      const scope = SUPPORTED_SCOPES.filter((s) => requested.includes(s)).join(" ");

      const codeChallenge = single(q, "code_challenge") || null;
      const codeChallengeMethod = single(q, "code_challenge_method");
      if (codeChallengeMethod !== undefined && codeChallengeMethod !== "S256") {
        return fail("invalid_request", "Only code_challenge_method=S256 is supported");
      }
      if (codeChallengeMethod === "S256" && !codeChallenge) {
        return fail("invalid_request", "code_challenge_method given without code_challenge");
      }
      if (client.clientSecretHash === null && !codeChallenge) {
        return fail("invalid_request", "Public clients must use PKCE (code_challenge)");
      }

      const nonce = single(q, "nonce") || null;
      const loginRequest: LoginRequest = {
        id: randomToken(16),
        clientId: client.id,
        redirectUri,
        scope,
        state,
        nonce,
        codeChallenge,
        siweNonce: randomSiweNonce(),
        expiresAt: new Date(deps.now().getTime() + LOGIN_REQUEST_TTL_MS),
      };
      await store.createLoginRequest(loginRequest);

      const location = new URL(config.loginUrl);
      location.searchParams.set("request", loginRequest.id);
      location.searchParams.set("issuer", config.issuer);
      return new Response(null, {
        status: 302,
        headers: { location: location.toString(), "cache-control": "no-store" },
      });
    },

    async interaction(_req: Request, id: string): Promise<Response> {
      const active = await activeLoginRequest(id);
      if (!active) return jsonError(404, "invalid_request");
      const { loginRequest, client } = active;
      return json(
        {
          client: { name: client.name, redirectHost: new URL(loginRequest.redirectUri).host },
          scope: loginRequest.scope,
          siwe: buildSiweTemplate(loginRequest, client, config, deps.now()),
        },
        200,
        { "cache-control": "no-store" },
      );
    },

    async complete(req: Request, id: string): Promise<Response> {
      const active = await activeLoginRequest(id);
      if (!active) return jsonError(404, "invalid_request");
      const { loginRequest, client } = active;

      let message: unknown;
      let signature: unknown;
      try {
        ({ message, signature } = (await req.json()) as { message?: unknown; signature?: unknown });
      } catch {
        return jsonError(400, "invalid_request", "Body must be JSON {message, signature}");
      }
      if (typeof message !== "string" || typeof signature !== "string" || !/^0x[0-9a-fA-F]*$/.test(signature)) {
        return jsonError(400, "invalid_request", "Body must be JSON {message, signature}");
      }

      const now = deps.now();
      let address: `0x${string}`;
      let chainId: number;
      try {
        const expected = buildSiweTemplate(loginRequest, client, config, now);
        ({ address, chainId } = await verifySiweLogin(message, signature as `0x${string}`, expected, now));
      } catch (err) {
        if (err instanceof OidcError) return jsonError(err.status, err.code);
        return jsonError(400, "invalid_request", "Malformed SIWE message");
      }

      if (!isSubjectAllowed(client, address)) {
        return jsonError(403, "access_denied", `This account is not allowed to sign in to ${client.name}`);
      }

      // Single use: the SIWE nonce is bound to this request.
      await store.deleteLoginRequest(loginRequest.id);

      const code = randomToken();
      await store.createAuthCode({
        codeHash: await sha256Hex(code),
        clientId: client.id,
        redirectUri: loginRequest.redirectUri,
        sub: subjectFor(address),
        address,
        // Kept for audit only; the subject is chain-independent.
        chainId,
        nonce: loginRequest.nonce,
        codeChallenge: loginRequest.codeChallenge,
        scope: loginRequest.scope,
        authTime: now,
        expiresAt: new Date(now.getTime() + AUTH_CODE_TTL_MS),
        usedAt: null,
      });

      return json({ redirect: appendQuery(loginRequest.redirectUri, { code, state: loginRequest.state }) }, 200, {
        "cache-control": "no-store",
      });
    },

    async token(req: Request): Promise<Response> {
      if (req.method !== "POST") {
        return jsonError(405, "invalid_request", "Use POST", { allow: "POST" });
      }
      const contentType = req.headers.get("content-type") ?? "";
      if (!/^application\/x-www-form-urlencoded\b/i.test(contentType)) {
        return jsonError(400, "invalid_request", "Body must be application/x-www-form-urlencoded");
      }
      const form = new URLSearchParams(await req.text());
      for (const key of new Set(form.keys())) {
        if (form.getAll(key).length > 1) return jsonError(400, "invalid_request", "A parameter was repeated");
      }

      const credentials = readClientCredentials(req, form);
      if (credentials instanceof Response) return credentials;
      const { clientId, clientSecret, usedBasic } = credentials;
      const invalidClient = () =>
        jsonError(401, "invalid_client", undefined, usedBasic ? { "www-authenticate": "Basic" } : undefined);

      const client = await clients.getClient(clientId);
      if (!isActive(client)) return invalidClient();
      if (client.clientSecretHash !== null) {
        if (clientSecret === undefined) return invalidClient();
        if (!constantTimeEqual(await hashSecret(clientSecret), client.clientSecretHash)) return invalidClient();
      }

      if (form.get("grant_type") !== "authorization_code") {
        return jsonError(400, "unsupported_grant_type");
      }

      const invalidGrant = () => jsonError(400, "invalid_grant");
      const code = form.get("code");
      if (!code) return invalidGrant();
      const now = deps.now();
      const codeHash = await sha256Hex(code);
      const consumed = await store.consumeAuthCode(codeHash, now);
      if (!consumed) return invalidGrant();
      if (!consumed.firstUse) {
        // Replay: the code may have leaked, so kill anything minted from it.
        await store.revokeAccessTokensForCode(codeHash);
        return invalidGrant();
      }
      const grant = consumed.code;
      if (isExpired(grant.expiresAt, now)) return invalidGrant();
      if (grant.clientId !== client.id) return invalidGrant();
      if (form.get("redirect_uri") !== grant.redirectUri) return invalidGrant();

      const verifier = form.get("code_verifier");
      if (grant.codeChallenge !== null) {
        if (!verifier || !(await verifyPkceS256(verifier, grant.codeChallenge))) return invalidGrant();
      } else if (verifier) {
        return invalidGrant();
      }

      const profile = await profiles.getProfile(grant.address);
      const claims: Record<string, unknown> = {
        ...buildClaims(grant.address, profile, grant.scope),
        auth_time: Math.floor(grant.authTime.getTime() / 1000),
      };
      if (grant.nonce !== null) claims.nonce = grant.nonce;
      const idToken = await keys.sign(claims, { audience: client.id, expiresInSec: ID_TOKEN_TTL_SEC });

      const accessToken = randomToken();
      await store.createAccessToken({
        tokenHash: await sha256Hex(accessToken),
        codeHash,
        clientId: client.id,
        sub: grant.sub,
        address: grant.address,
        scope: grant.scope,
        expiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_SEC * 1000),
        revoked: false,
      });

      return json(
        {
          access_token: accessToken,
          token_type: "Bearer",
          expires_in: ACCESS_TOKEN_TTL_SEC,
          id_token: idToken,
          scope: grant.scope,
        },
        200,
        { "cache-control": "no-store", pragma: "no-cache" },
      );
    },

    async userinfo(req: Request): Promise<Response> {
      const invalidToken = () =>
        jsonError(401, "invalid_token", undefined, { "www-authenticate": 'Bearer error="invalid_token"' });
      const match = /^bearer\s+(\S+)\s*$/i.exec(req.headers.get("authorization") ?? "");
      if (!match) return invalidToken();

      const token = await store.getAccessToken(await sha256Hex(match[1]));
      if (!token || token.revoked || isExpired(token.expiresAt, deps.now())) return invalidToken();

      const profile = await profiles.getProfile(token.address);
      return json(buildClaims(token.address, profile, token.scope), 200, { "cache-control": "no-store" });
    },
  };
}
