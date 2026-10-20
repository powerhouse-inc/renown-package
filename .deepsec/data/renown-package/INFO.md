# renown-package

## What this codebase does

Renown is a TypeScript ESM Reactor package, not a standalone web server.
Powerhouse Switchboard hosts its GraphQL subgraphs and registered HTTP routes;
Connect hosts its React editors. It provides wallet-linked users, verifiable
credentials, organizations, OIDC clients/login, GitHub workload identities,
media uploads and public application/profile indexes. Kysely-backed relational
namespaces and Reactor documents coexist: org authorization reads Kysely; org
documents are mirrors. User/credential processors do not write org tables.
Trace mirror drift and direct-document effects on OIDC claims/public reads.

## Auth shape

- Switchboard supplies resolver `ctx.user` after bearer authentication; an
  address in args alone is not equivalent to that trusted context. OIDC and
  workload registry GraphQL instead use static registration-token headers
  (`X-Renown-OIDC-Registration-Token` / `X-Renown-Workload-Registration-Token`);
  inspect the token holder's authority over client and owner-address inputs.
- Org `provenAddress`/`requireAddress` and `OrgRuntime.writer`/`caller` verify
  signed `orgMessage` payloads or use the host bearer. Only signed writes are
  consumed once; check read replay, restart/replica durability and cross-host
  replay (messages bind field/org/args/time, not host/chain). ERC-1271/6492
  falls back to chain-1 RPC: check attacker-controlled call resource bounds.
- `requireOrg`, `requireRole`, `hasAppCapability` and `effectiveScope` implement
  org status, active membership, role and per-app/team scope checks. Verify
  that each read/write uses the appropriate combination.
- Auth mutations use `validateCredentialInput`, `verifyCredentialSignature`,
  `verifySignedMessage` and smart-wallet verification; follow issuer/subject,
  delegation, revocation and app-key ownership checks through their callers.
- OIDC handlers implement their own protocol checks behind public HTTP routes;
  workload exchange verifies GitHub claims before minting an app-did:key
  VC-JWT carrying the registered owner wallet. Trace exactly which claims are
  checked; do not assume environment/workflow identity is bound.

## Threat model

Consider anonymous callers, malicious registered users/org members, compromised
app keys and untrusted GitHub workflows. Highest impacts are forging identity
or credentials, unauthorized token issuance, cross-org/app access and changes
to membership, ownership or key material. Also inspect private profile/index
disclosure, webhook/domain-proof network access, and media/storage boundaries.
Infrastructure configuration and host authentication are trust boundaries:
identify any finding's deployment assumptions and attacker prerequisites.

## Project-specific patterns to flag

- Custom ingress: `this.http.get`/`post` registrations, resolver factories and
  org `Area` maps. Guards can live in runtime/helpers rather than middleware;
  trace those wrappers before deciding a resolver lacks authorization.
- OIDC client registration, redirect allowlists, PKCE/SIWE interactions and
  one-use codes in `subgraphs/renown-oidc/`; check org client ownership and
  scopes/claims against current membership and app policy.
- Workload exchange in `subgraphs/renown-workload/` binds GitHub repository,
  ref classification and audience to registered identity and encrypted keys;
  trace deny/revoke/frozen-org behavior through token and registry paths.
- Org webhook/domain-proof code combines `vetUrl`, `guardedRequest`, DNS,
  retries, encryption and activity sinks. Domain verification can enable org
  recovery: check proof binding, age checks and expired/re-registered domains.
  Verify special IP forms and callers without port allowlists; pinning and no
  redirects do not prove every destination safe. Check async jobs/secrets.
- Media reservation/upload/serve paths in `media/` use attachment references,
  content hashes, byte sniffing and S3 or filesystem backends. Trace client
  claims versus stored-object inspection and profile/app-image authorization.

## Other review surfaces

- `renown-user`, `renown-read-model` and `renown-stats` expose reads beyond
  directory search: check arbitrary document lookup, credential/profile dumps,
  listing opt-in, undeclared/private metrics and pagination/resource bounds.
  Org read throttles can use X-Forwarded-For/X-Real-IP without a trusted read
  token; verify proxy trust and spoofed-address limit evasion.
- Processors and stats backfills consume document actions/state. Check rejected
  operation handling, drive provenance, identity binding and dual-write drift.
- Editors dispatch actions directly and render user URLs. Inspect generated
  mutations as reachable ingress even though generated code is not editable.
- `.github/workflows/`, `scripts/ci/` and `docker/` affect release credentials,
  dispatch payload interpolation, host access policy and ingress assumptions.

## Known false-positives

- Public OIDC discovery/JWKS and token endpoints are protocol entry points;
  authorize/interaction/userinfo are also public. Review state binding,
  rate limits, writes and resource bounds; public does not mean safe.
- Tests use injected clocks, IDs, mock stores/networks and cryptographic test
  keys; distinguish fixtures from secrets or fallbacks reachable in production.
- Reducers do not enforce caller authorization. Audit generic document/drive
  mutations and sync as alternate ingress: resolver checks do not prove those
  writes are protected. Deployment auth policy is external; historical design
  docs describe OPEN access, but do not establish current deployed policy.
  User/credential processors index matching documents across drives without
  signature verification; trace poisoned state into identity and public reads.
- Generated `gen/` files mirror model declarations, and client SDKs construct
  signed payloads; neither is an independent server authorization boundary.
- Public directory/profile reads exist intentionally; verify listing opt-in,
  org status, field selection and private relations instead of assuming all
  indexed data is public. These notes are hypotheses, not suppressions.
