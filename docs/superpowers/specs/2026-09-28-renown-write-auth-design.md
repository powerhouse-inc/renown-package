# Closing anonymous writes on the Renown switchboard

**Date:** 2026-09-28
**Status:** draft, awaiting review
**Scope:**
- `renown-package` (this repo): mutations, and removing the unchecked ones
- `renown` (the app; deployed to k8s and Vercel)
- `powerhouse` `@renown/sdk`
- clients: vetra.io, the pfnur portal and scripts, vetra-cli
- `powerhouse-k8s-hosting`: the `tenants/renown` flags

## Goal and success criteria

Anonymous callers can no longer create, change, revoke or delete Renown
documents (credentials and profiles). Every existing flow keeps working.

**Must keep working, verified locally before shipping and live afterwards:**
- Connect login in every Connect deployment and version in the cluster:
  6.0.x, 6.2.0-dev.46, 6.2.0-rc.8, 6.2.1 and 6.2.3-dev.x.
- `ph login` and vetra-cli, including studio agents' "Authorize agent".
- vetra.io login on prod and staging.
- toll-hunter.com and pfnuer-dev portal login (Privy email OTP), plus the pfnur
  worker and service identity ceremony.
- phop and rfp-hub (redirect login).
- Bearer verification on every switchboard and registry that verifies Renown
  tokens.
- Renown OIDC (Speckle).
- The Renown app itself: web flow, console flow, profile pages, revoke.
- In general, every environment in the k8s cluster.

**Must be closed:**
- Anonymous or unauthorized use of `createEmptyDocument`, `createDocument`,
  `execute(Async)`, `mutateDocument`, `deleteDocument(s)`, rename, relationship
  mutations, `pushSyncEnvelopes` and the typed per-model mutations
  (`RenownCredential_*`, `RenownUser_*`, `DocumentDrive_*`, …).
- Revoking someone else's credential.
- Editing someone else's profile.
- Making a copy of someone's (public) signed credential to shadow or revoke it.

## Current state (verified 2026-09-26 to 2026-09-28)

- **The switchboard enforces nothing.** `switchboard.renown.vetra.io` (v1.4.0,
  PH 6.2.3-dev.26) runs with no auth flags, so the access policy is `OPEN`.
  Every mutation is allowed for anonymous callers.
- **The Renown app routes are open write proxies.**
  - `POST /api/credential/renown` writes whatever it is sent. It does not check
    the signature on the server.
  - `DELETE /api/credential/renown` and `DELETE /api/auth/credential?id=` revoke
    any credential.
- **The `renown-user` subgraph has unchecked mutations.** `RenownUser_*`
  (`subgraphs/renown-user/resolvers.ts:75-135`) write with no checks, and
  nothing calls them.
- **Profiles can be spoofed.** A profile lookup returns the *newest*
  `renown-user` document for an address.
- **Writers today, all anonymous:**
  - the Renown app server. This covers Connect's redirect login and the console
    flow used by `ph login`, vetra-cli and agents. It runs on k8s at
    renown.vetra.io and on **Vercel at www.renown.id**, which most clients
    default to.
  - in-page `@renown/sdk` `Renown.signIn`: vetra.io (SDK 6.2.2-dev.23) and the
    pfnur portal (SDK 6.2.3-dev.7).
  - `pfnur scripts/worker-identity.mjs` (issue and revoke).
  - `vetra-cli scripts/publish/provision-credential.mjs`.
- **Readers only:** every other switchboard, the registries, phop's server and
  vetra.io's cookie check. They read `renownCredentials` through the Renown
  app's REST `/api/auth/credential`, or directly from the switchboard's package
  subgraph.

## Design

### 1. Switchboard: the built-in policy closes the generic surface (phase 3)

The `tenants/renown` switchboard env gets:

```
AUTH_ENABLED: "true"
ADMINS: "0x1ad3d72e54fb0eb46e87f82f77b284fc8a66b16c,0x50379ddb64b77e990bc4a433c9337618c70d2c2a,0x9273660e536394c135389743d3005fa463d0f1c5,0x9addcbbaa28f7eb5f75e023f7c1fcb13c9dfd8f7,0x2bbea0145d6fb9c6709a74c1179ca0be71bb3ac6"
RENOWN_SOURCE: "self"
```

- **`ADMIN_ONLY` for the core document API.** With `AUTH_ENABLED` and no
  document permissions, the policy is `ADMIN_ONLY`: only `ADMINS` may use the
  core document API and the generated per-model subgraphs. That covers create,
  mutate, delete, rename, relationships, sync, and core document reads.
- **Package subgraphs are unaffected.** Their resolvers keep answering
  anonymously, so all reads (`renownCredentials`, `renownUsers`, the read
  model) and the OIDC routes keep working.
- **`RENOWN_SOURCE=self`** verifies login tokens in process against the local
  read model. This avoids the self-call through the Renown app.

**Why not document permissions** (the approach approved in chat, revised here):
- Any logged-in user can create documents. A logged-in attacker could create a
  copy of a victim's public signed credential and revoke it, or create a
  `renown-user` document with the victim's address.
- Stopping that would need read models that check ownership, plus an owner
  backfill across about 23k existing documents.
- Enabling it also crashes the migrator on Postgres (`kysely_migration_lock`).
- Every legitimate write goes through the mutations in section 2 anyway, so
  `ADMIN_ONLY` shuts out everything else more simply.

### 2. renown-package: self-authenticating mutations (phase 1)

A new public subgraph `renown-auth`. Its resolvers write with the in-process
reactor client (system writes), which the host policy does not apply to. Every
resolver authorizes the caller itself.

**`renown_issueCredential(input: RenownCredential_InitInput!, username: String, userImage: String, userDocId: PHID): String`**

This keeps the signature the SDK branch expects
(`powerhouse origin/feat/renown-credential-issuance-sdk`), and ports the
validation from `renown-package origin/feat/credential-issuance-subgraph`
(a6a6f83):
- It checks the structure, the bounds and the allowed chain ids, then verifies
  the EIP-712 signature (`verifyCredentialSignature`).
- It is idempotent by `credentialId`: an existing credential returns its
  document id.
- It returns the credential document id.
- `username` and `userImage` are applied **only when the address has no profile
  yet**. A replayed public credential can create at most the victim's own,
  empty, first profile. It never changes an existing one.
- `userDocId` is accepted for SDK compatibility and ignored. The address decides
  which profile document is used.

**`renown_revokeCredential(credentialId: String!, signature: String, timestamp: String): Boolean`**

Authorized by either:
- a login token (Authorization header) whose resolved address equals the
  credential's issuer address, or
- a `personal_sign` by the issuer address over
  `Revoke Renown credential <credentialId> at <timestamp>`, where the timestamp
  must be within ±10 minutes. This serves the Renown UI (wallet signature) and
  the pfnur script (its eth key).

It is idempotent: revoking an already revoked credential returns true.

**`renown_upsertProfile(address: String!, username: String, userImage: String, signature: String, timestamp: String): String`**

Authorized the same way (login token address equals `address`, or a
`personal_sign` of `Update Renown profile <address> <sha256(json)> at <timestamp>`).
- **There is one canonical profile per address.** It updates the newest existing
  profile document for the address, or creates one.
- It returns the profile document id.

**`renown-user` subgraph:** remove the unchecked `RenownUser_*` mutations. The
typed per-model subgraph is admin-only under `ADMIN_ONLY` anyway.

**Limits:** input size bounds as in a6a6f83, plus a per-address issuance rate
limit (in memory, 30 per minute) against junk creation.

### 3. Renown app (phase 2; both the k8s and the Vercel deployments)

- `POST /api/credential/renown` calls `renown_issueCredential` with the signed
  credential, plus the profile fields for first creation. The server no longer
  writes documents directly.
- The DELETE routes require the revoke signature from the browser (the wallet
  signs; Privy signs silently) and call `renown_revokeCredential`.
  `DELETE /api/auth/credential?id=` without a signature returns 401.
- Profile edits call `renown_upsertProfile` with a wallet signature.
- Reads are unchanged. `/api/auth/credential`, `/api/auth/verify`,
  `/api/status` and `/api/switchboard` keep their responses.

### 4. `@renown/sdk` (phase 2; based on acaldas's SDK branch)

- `issueCredential` calls `renown_issueCredential`. It falls back to the legacy
  anonymous path only when the switchboard's schema lacks the mutation, which
  is how the branch already works.
- Profile writes call `renown_upsertProfile` with the login token. This replaces
  the branch's generic `createEmptyDocument`/`mutateDocument` with a token,
  which `ADMIN_ONLY` would reject.
- `revokeCredential(credentialId, { token } | { signature, timestamp })`.
- Released on the dev channel. Consumers bump to it.

### 5. Clients (phase 2)

- **vetra.io:** bump the SDK on `main` (prod) and `staging`. It has diverged,
  so this is a cherry-pick PR.
- **pfnur portal:** bump the SDK, rebuild `portal`, and roll pfnuer-dev, then
  pfnuer-prod (toll-hunter.com).
- **pfnur scripts:** `scripts/worker-identity.mjs` calls issue and revoke with
  signatures from its eth key. The e2e stub switchboard
  (`e2e/setup/renown-switchboard.ts`) learns the new mutations.
- **vetra-cli:** `provision-credential.mjs` calls `renown_issueCredential`.
- **No change:** Connect (all versions), ph-cli, phop, rfp-hub, the registries
  and every verifying switchboard. They read, or they write only through the
  Renown app.

## Rollout

| Phase | What | Effect |
|---|---|---|
| 0 | Baseline: a read-only health probe of every environment (below), recorded. | none |
| 1 | Release renown-package with `renown-auth`, then the renown switchboard image. Flags stay off. | Additive. The old paths still work. |
| 2 | SDK release; Renown app on k8s and Vercel; vetra.io staging then prod; pfnur dev then prod; vetra-cli; pfnur script. | Clients use the new mutations. Everything still works because nothing is closed yet. |
| 3 | **Local gate** (Testing, first part) passes with the flags on. Then set the flags in `tenants/renown`. | Anonymous writes are closed. |
| 4 | Live verification of every environment (Testing, second part), compared with the phase 0 baseline. | Roll back on any regression. |

**Rollback:** revert the `tenants/renown` flags commit and let ArgoCD re-sync.
Writes reopen within about a minute. The mutations stay, and so do clients'
compatible paths.

## Testing

### Local gate, before phase 3 ships

The switchboard image is built from this branch with the phase 3 flags, runs
against a **fresh copy of the production Renown DB**, and is paired with the
Renown app run locally. Every item below must pass:

1. **Negative tests:**
   - Anonymous and logged-in non-admin calls to each generic mutation are
     denied.
   - `RenownUser_*` is gone.
   - Revoking someone else's credential, by login token or by signature, is
     denied.
   - A replayed public credential cannot change an existing profile, and cannot
     create a second profile.
   - A signature with an expired or future timestamp is denied.
2. **Renown app web flow** (Connect's redirect login): issue a credential, then
   verify it through the REST route and through `renownCredentials`. Run this
   with each Connect version in use by pointing the verifier SDK of each
   version at the local app: 6.0.x, 6.2.0-dev.46, 6.2.0-rc.8, 6.2.1 and
   6.2.3-dev.26.
3. **Console flow** (`ph login`, vetra-cli): run it end to end through the local
   app.
4. **In-page `signIn` with the new SDK**, with a scripted wallet adapter:
   issuance, profile, and a follow-up login using the login token.
5. **pfnur portal**, run locally against the local Renown with the new SDK:
   - its e2e suite
   - `worker:identity` issue and revoke
6. **vetra.io**, run locally with the new SDK: login and the session cookie
   check.
7. **vetra-cli `provision-credential`** against the local switchboard.
8. **Bearer verification** by the switchboard versions in the fleet
   (6.2.0-dev.46, 6.2.3-dev.20, 6.2.3-dev.26, the pfnur reactor image) and the
   registry against the local Renown: a freshly issued token is accepted, and
   is rejected after revoke.
9. **Renown OIDC:** discovery, and a full login with openid-client v5.
10. **Renown app:** the revoke button (wallet signature), profile edit,
    profile pages, `/api/status`, and `/api/switchboard`.

### Live verification of every environment (phases 0 and 4)

A script enumerates every tenant, from the tenant values plus the ArgoCD apps,
and records:
- **Connect:** `/` returns 200, and the runtime config's Renown URL.
- **Switchboards:** `/graphql` returns 200.
- **Auth-enabled switchboards and registries:** a login token for a throwaway
  wallet, issued through the new mutation, is accepted by a query that needs
  the caller's identity. It is rejected after revoke.
- **Renown app on both deployments:** the REST routes respond.
- **OIDC discovery** responds.

Phase 4 compares against the phase 0 baseline. Any difference blocks the
rollout and triggers a rollback.

## Assumptions and open points

- `ADMINS` are the same five addresses as on the vetra tenant (confirmed by the
  user).
- The Vercel `www.renown.id` project deploys from `renown` `main`. **Verify
  this before phase 2.**
- We own and can deploy the pfnur portal (the image is built by its repo's CI;
  the manifests are in k8s-hosting).
- Existing duplicate or spoofed `renown-user` documents stay as they are.
  Cleaning them up is a separate, optional task.
- Out of scope: the prod switchboards' `NODE_ENV=development` (stack traces in
  errors), and the already-broken `getProfiles` query in vetra-builder-package.
