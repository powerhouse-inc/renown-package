# Renown as an OpenID Connect provider

**Date:** 2026-09-26
**Status:** draft, awaiting review
**Scope:**
- `renown-package` (this repo): document model, editor, subgraph and HTTP routes
- `renown` (the Next.js app): one sign-in page
- deployment: a new renown switchboard image and signing-key secret in
  powerhouse-k8s-hosting

## Why

Services we host want "Sign in with Renown":
- Speckle, the first consumer (the vetra.io 3D Models add-on)
- Paperless, which replaces the planned forward-auth
- Grafana, ArgoCD, Harbor and OpenPanel

All of them speak OpenID Connect; none of them speak Renown. Renown has no OIDC
endpoints today. This adds a minimal, standards-conformant OIDC provider:
authorization-code flow with PKCE, on the renown switchboard, using Renown's
existing wallet and Privy sign-in for the interactive step.

## Decisions

| | Decision | Why |
|---|---|---|
| Host | the renown switchboard, as HTTP routes of a renown-package subgraph (`this.http`, reactor-api ≥ 6.2.3-dev.0) | the user asked for it in renown-package; no new service to run |
| Issuer | `https://switchboard.renown.vetra.io/api/@powerhousedao/renown-package/oidc`, overridable with `RENOWN_OIDC_ISSUER` | the route namespace is fixed by the host; a prettier `auth.vetra.io` can later be a Traefik rewrite plus `RENOWN_OIDC_ISSUER` |
| Proof of identity | a sign-in-with-Ethereum (EIP-4361) message, signed in the Renown app, that binds the login request id | works for wagmi and Privy (embedded EOA) wallets; verified with viem, no dependency on Renown JWT or credential internals |
| Subject (`sub`) | `did:pkh:eip155:<chainId>:<checksummed address>` | the identity vetra.io already uses for owners |
| Clients | a `renown/oidc-client` document each | registrations are auditable, event-sourced and editable in Connect |
| Short-lived state | subgraph relational namespace `renown_oidc` | login requests, codes and access tokens are ephemeral and must not be document history |
| Signing key | ES256 private JWK from env `RENOWN_OIDC_SIGNING_KEYS` (JSON array: first key signs, all are published in JWKS) | a private key never goes into document state; rotation means prepend a new key and later drop the old one |
| Library | `jose` for JWT and JWK; the protocol handlers are written here and kept small | `oidc-provider` assumes it owns a Koa/Express app and a persistence adapter, which does not fit the host-owned route scope |

## Document model `renown/oidc-client`

Global state:

```graphql
type RenownOidcClientState {
  clientId: String            # set once; defaults to the document id
  name: String                # shown on the Renown consent screen
  redirectUris: [URL!]!       # exact match, https only (http://localhost allowed)
  allowedSubjects: [String!]! # DIDs or 0x addresses; empty = nobody
  allowAnySubject: Boolean!   # opt-in public login; default false
  clientSecretHash: String    # "sha256:<hex>"; null = public client, PKCE only
  status: RenownOidcClientStatus! # ACTIVE | DISABLED
}
```

Operations (module `client`):
- `SET_CLIENT_INFO` {name, clientId?}. clientId is only settable while empty.
- `ADD_REDIRECT_URI`, `REMOVE_REDIRECT_URI` {uri}
- `ADD_ALLOWED_SUBJECT`, `REMOVE_ALLOWED_SUBJECT` {subject}. Addresses are
  normalised to lowercase `0x…`; a DID `did:pkh:eip155:<n>:<addr>` is reduced to
  its address.
- `SET_ALLOW_ANY_SUBJECT` {allow}
- `SET_CLIENT_SECRET_HASH` {hash}. The plaintext secret never enters a document.
- `SET_STATUS` {status}

Reducers are pure. They validate URIs (https, or http on localhost), dedupe,
and are 100 % unit-tested like the existing models.

## Editor `renown-oidc-client-editor`

A form for name, redirect URIs, allowed subjects, the allow-any toggle and
status. **Rotate secret** generates 32 random bytes in the browser, shows the
plaintext exactly once, and dispatches only its hash.

## Subgraph `renown-oidc`

**GraphQL** (at `/graphql/renown-oidc`) for automation:

```graphql
type Mutation {
  registerOidcClient(input: RegisterOidcClientInput!): RegisteredOidcClient!
  # returns { clientId, clientSecret }; the secret is returned only here
}
input RegisterOidcClientInput {
  name: String!
  redirectUris: [URL!]!
  allowedSubjects: [String!]!
  confidential: Boolean = true
}
```

Authorised by a bearer registration token: `RENOWN_OIDC_REGISTRATION_TOKEN`,
compared in constant time (an RFC 7591-style initial access token). The
resolver creates the document with `reactorClient.createEmpty` and a
system-signed `execute`, the pattern `vetra-cloud-package` uses.

**HTTP routes**, under `<issuer>`, all with `auth: "public"`. The host would
otherwise read any `Authorization` header as a Renown token.

| Route | Behaviour |
|---|---|
| `GET /.well-known/openid-configuration` | discovery: issuer, endpoints, `response_types_supported: ["code"]`, `grant_types_supported: ["authorization_code"]`, `code_challenge_methods_supported: ["S256"]`, `id_token_signing_alg_values_supported: ["ES256"]`, `token_endpoint_auth_methods_supported: ["client_secret_basic","client_secret_post","none"]`, `scopes_supported: ["openid","profile","email"]`, claims |
| `GET /jwks` | public JWKs |
| `GET /authorize` | see step 1 of the flow below |
| `GET /interaction/:id` | JSON for the sign-in page: client name, redirect host, scopes, nonce, expiry, and the exact EIP-4361 message to sign |
| `POST /interaction/:id/complete` | see step 3 of the flow below |
| `POST /token` | see step 4 of the flow below |
| `GET\|POST /userinfo` | Bearer access token → the same claims as the ID token |

**Authorize flow:**

1. `GET /authorize` validates `client_id` (ACTIVE), `redirect_uri` (exact
   match), `response_type=code`, `scope` ⊇ `openid`, and `code_challenge` with
   `S256`. PKCE is required for public clients and accepted for confidential
   ones. It stores a login request (10 min TTL) and redirects to
   `https://renown.vetra.io/oidc/login?request=<id>`. Errors that concern the
   redirect URI render an error page, never a redirect. Other errors go back to
   the redirect URI with `error=…&state=…`, per the spec.
2. The user signs in on the Renown app page, which fetches
   `GET /interaction/:id` and signs the EIP-4361 message it returns.
3. `POST /interaction/:id/complete` takes `{message, signature}`. The route:
   - checks that the message is exactly the one it issued for this request
     (domain, URI, request id, nonce, expiry)
   - verifies the signature with viem `verifyMessage`
   - derives the address
   - checks it against the client's allowed subjects, returning 403
     `access_denied` if not allowed
   - issues a single-use code (60 s TTL, stored as a hash, bound to client,
     redirect URI, PKCE challenge, nonce and subject)
   - returns `{ redirect: "<redirect_uri>?code=…&state=…" }`
4. `POST /token` takes `grant_type=authorization_code`, with the client
   authenticated by basic or post secret, or `none` plus PKCE for a public
   client. It checks and consumes the code exactly once; a replayed code revokes
   the access tokens already issued from it. It returns:
   - `id_token`: ES256 JWT with `iss`, `sub`, `aud`=client_id, `exp` (+10 min),
     `iat`, `nonce`, `auth_time`, plus the claims below
   - `access_token`: opaque, 1 h, stored as a hash, usable only at userinfo
   - `token_type: Bearer`, `expires_in`

   There are no refresh tokens in v1.

**Claims:**
- `sub`
- `name` and `preferred_username`: the Renown username, from the user's
  `powerhouse/renown-user` document when one exists, else the short address
- `email`: the user's email when Renown knows it. Otherwise
  `<lowercase address>@renown.vetra.io` with `email_verified: false`. Speckle
  requires an email claim.
- `picture`: the userImage

**Relational namespace `renown_oidc`:**
- `login_requests`: id, client_id, redirect_uri, scope, state, nonce,
  code_challenge, siwe_nonce, expires_at
- `auth_codes`: code_hash, client_id, redirect_uri, sub, nonce, code_challenge,
  scope, expires_at, used_at
- `access_tokens`: token_hash, client_id, sub, scope, expires_at, revoked

A cleanup of expired rows runs every 5 min in the subgraph.

## Renown app (`renown` repo)

A `pages/oidc/login.tsx` page:
1. Reads `?request`, fetches the interaction, and shows "**<client name>** at
   **<redirect host>** wants to sign you in with Renown".
2. Signs in with the existing auth orchestrator (wallet or Privy), then
   `signMessage(message)`.
3. POSTs to `/complete` and navigates to the returned redirect.

A 403 shows "This account is not allowed to sign in to <client>".

## Security notes

- PKCE S256 is required for public clients. Codes are single-use, 60 s, stored
  hashed; replay revokes access tokens. `state` and `nonce` pass through.
- Redirect URIs are exact matches. The login page displays the redirect host,
  so a client registered for someone else's host is visible to the user.
- The allowed-subject list is enforced on every login. `allowAnySubject` is
  explicit and off by default.
- Secrets exist only as sha256 hashes. They are 256-bit random, so a plain
  sha256 is sufficient.
- The signing key comes from env (OpenBao via ESO in the renown tenant). JWKS
  publishes all configured keys for rotation.
- CORS: the Renown app origin must be allowed on `/interaction/*`; `/token` is
  server-to-server.
- Rate limiting of `/complete` and `/token` is left to Traefik middleware in the
  deployment.

## Out of scope (v1)

- refresh tokens
- a consent memory ("remember this app")
- `prompt` and `max_age` beyond passthrough
- front- or back-channel logout
- dynamic registration by anyone without the registration token
- a Renown profile email field. When `renown-user` gains `email`, the claim uses
  it with no protocol change.

## Consumers (follow-up specs)

- **Speckle add-on:**
  - The chart's bootstrap calls `registerOidcClient` with redirect
    `https://<sub>-speckle.vetra.io/auth/oidc/callback` and allowed subject = the
    environment owner, emitted by gitops.
  - It sets `STRATEGY_OIDC=true`, `OIDC_NAME=Renown`, `OIDC_DISCOVERY_URL`, and
    `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` from a Secret.
  - Human sign-up with email and password is closed by blocking
    `/auth/local/*` at the public ingress.
- **Paperless, Grafana, ArgoCD:** standard OIDC client configuration.

## Testing

- **Reducers:** 100 % coverage, as for the existing models.
- **Pure protocol functions** (unit): request validation, SIWE message
  build/verify, PKCE, code and token lifecycle, JWT claims, discovery document.
- **Subgraph routes:** an in-memory integration test drives the whole flow with
  a viem test account: authorize → complete → token → userinfo. It verifies the
  ID token against JWKS with `jose`, and covers the denials (wrong subject,
  replayed code, bad PKCE, bad redirect).
- **Live:** there is no separate staging Renown; `tenants/renown` is the only
  instance. The new routes are additive and inert until a client is registered,
  so the new image ships there. Then register a test client, run the whole flow
  with `openid-client` (the certified relying-party library) from a local
  script, and point one staging Speckle at it.
