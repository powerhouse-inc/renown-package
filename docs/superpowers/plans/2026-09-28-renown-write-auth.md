# Renown Write Authorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close anonymous writes on the Renown switchboard. Every legitimate
writer moves to three self-authenticating mutations, then the built-in
`ADMIN_ONLY` policy closes everything else. No environment in the cluster may
break.

**Architecture:**
- **renown-package** gains a public `renown-auth` subgraph:
  `renown_issueCredential`, `renown_revokeCredential` and
  `renown_upsertProfile`. They write as the system through `reactorClient`,
  and each resolver authorizes the caller itself: an EIP-712 credential proof,
  a login token resolved in process, or a timestamped `personal_sign`.
- **Clients:** the Renown app, `@renown/sdk`, vetra.io, the pfnur portal and
  scripts, and vetra-cli move to these mutations. Old SDKs keep working
  through the Renown app or the SDK's fallback until the flip.
- **The flip:** `AUTH_ENABLED` + `ADMINS` is set on `tenants/renown`, but only
  after a local gate on a production-data copy passes.

**Tech Stack:** TypeScript, Powerhouse reactor-api 6.2.3-dev.26 (package
subgraphs, `reactorClient`, relationalDb/Kysely), `@renown/sdk`
(`verifyCredentialSignature`), `viem` (`verifyMessage`), Vitest, Next.js
(Renown app, vetra.io, pfnur portal), Playwright, Helm and ArgoCD.

**Spec:** `docs/superpowers/specs/2026-09-28-renown-write-auth-design.md` (read it first)

## Global Constraints

- **Repos and branches:**
  - renown-package: `/home/f/projects/renown-package-oidc`, branch
    `feat/renown-write-auth` from `origin/main`.
  - renown app: a new worktree from `origin/main`.
  - powerhouse: branch from `origin/feat/renown-credential-issuance-sdk`,
    rebased on `origin/main`.
  - vetra.io: `main`, plus a cherry-pick PR to `staging`.
  - pfnur: `/home/f/projects/pfnur-toll-collect-portal`, new branch.
  - vetra-cli: `/home/f/projects/vetra-cli`, new branch.
  - k8s-hosting: `main` via PR.
- **Git hygiene:**
  - Commits are small and conventional, with **no Co-Authored-By or AI
    attribution**.
  - Stage explicit paths only.
  - A PR is merged only after its CI checks pass. Confirm this with
    `gh pr checks` before running `gh pr merge`.
- **Mutation names and signatures, verbatim:**
  - `renown_issueCredential(input: RenownCredential_InitInput!, username: String, userImage: String, userDocId: PHID): String`
  - `renown_revokeCredential(credentialId: String!, signature: String, timestamp: String): Boolean`
  - `renown_upsertProfile(address: String!, username: String, userImage: String, signature: String, timestamp: String): String`
- **Canonical signed messages, verbatim:**
  - revoke: `Revoke Renown credential ${credentialId} at ${timestamp}`
  - profile: `Update Renown profile ${address.toLowerCase()} ${sha256hex(JSON.stringify({username: username ?? null, userImage: userImage ?? null}))} at ${timestamp}`
  - `timestamp` is ISO-8601, accepted within ±600 000 ms of the server time.
- **Signatures:** `personal_sign` (EIP-191), verified with viem `verifyMessage`
  (offline, EOA). EIP-712 credential proofs are verified with `@renown/sdk`
  `verifyCredentialSignature`.
- **Issuance side effects:** `username` and `userImage` from issuance apply
  **only when the address has no profile yet**. `userDocId` is ignored.
- **Rate limit:** issuance is limited to 30 per minute per issuer address, in
  memory.
- **Flags, phase 1** (`tenants/renown` switchboard env): `RESOLVE_CALLER_IDENTITY: "true"`, `RENOWN_SOURCE: "self"`.
- **Flags, phase 3:** add `AUTH_ENABLED: "true"` and `ADMINS: "0x1ad3d72e54fb0eb46e87f82f77b284fc8a66b16c,0x50379ddb64b77e990bc4a433c9337618c70d2c2a,0x9273660e536394c135389743d3005fa463d0f1c5,0x9addcbbaa28f7eb5f75e023f7c1fcb13c9dfd8f7,0x2bbea0145d6fb9c6709a74c1179ca0be71bb3ac6"`.
- **Production data:** read only, through a dump taken to a file inside the
  CNPG pod (`split` + `kubectl exec cat`, then verify the sha256). Afterwards
  terminate any leftover `pg_dump` backend (`pg_stat_activity`) **and** delete
  the local copy.
- **Order of flipping:** nothing flips before Task 11 (local gate) passes and
  Task 10's phase 0 baseline is recorded.

## Review Focus

1. **A replayed public credential** posted to `renown_issueCredential` with a
   different `username` must return the existing credential and must not
   change the profile (pinned in Task 2).
2. **A revoke signed by a different wallet, or a valid signature with a
   timestamp 11 minutes old or in the future,** must be denied, and the
   credential must stay active (pinned in Task 2).
3. **A login token whose address differs from the credential issuer or the
   profile address** must be denied, even though the token itself is valid
   (pinned in Task 2).
4. **An old client on an SDK without the new mutations,** during phases 1–2,
   must still sign in exactly as today (pinned in Task 4, fallback, and Task 11).
5. **After the flip, an anonymous or non-admin call to any generic mutation**
   (`createEmptyDocument`, `execute`, `mutateDocument`, `deleteDocument`,
   `pushSyncEnvelopes`, `RenownCredential_revoke`) must be denied, while
   `renownCredentials` and `/api/auth/credential` still answer anonymously
   (pinned in Task 11).

---

## Part A: renown-package

### Task 1: `renown-auth` core (pure modules)

**Files:**
- Create: `subgraphs/renown-auth/core/credential-input.ts` (port of `validateStructure`, `allowedChainIds`, the bounds and the clock skew from `git show origin/feat/credential-issuance-subgraph:subgraphs/renown-credential-issuance/resolvers.ts`, adapted to the new layout's imports: `document-models/renown-credential/v1`)
- Create: `subgraphs/renown-auth/core/signed-message.ts`
- Create: `subgraphs/renown-auth/core/rate-limit.ts`
- Test: `subgraphs/renown-auth/tests/core.test.ts` (also port the validation cases from the draft's `resolvers.test.ts`)

**Interfaces (produces):**
```ts
// credential-input.ts
export function validateCredentialInput(input: InitInput, now?: Date): PowerhouseVerifiableCredential // throws Error("Invalid request: …")
export function issuerAddressOf(input: InitInput): `0x${string}` // lowercased address from issuer did:pkh
// signed-message.ts
export const SIGNATURE_WINDOW_MS = 600_000;
export function revokeMessage(credentialId: string, timestamp: string): string;
export async function profileMessage(address: string, profile: { username?: string | null; userImage?: string | null }, timestamp: string): Promise<string>;
export function isFreshTimestamp(timestamp: string, now: Date): boolean;
export async function verifySignedMessage(args: { address: string; message: string; signature: string }): Promise<boolean>; // viem verifyMessage, false on throw
// rate-limit.ts
export function createRateLimiter(limit: number, windowMs: number): { take(key: string, now?: number): boolean };
```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { revokeMessage, profileMessage, isFreshTimestamp, verifySignedMessage, SIGNATURE_WINDOW_MS } from "../core/signed-message.js";
import { createRateLimiter } from "../core/rate-limit.js";

const now = new Date("2026-09-28T12:00:00.000Z");
describe("signed messages", () => {
  it("revoke message is exact", () => {
    expect(revokeMessage("cred-1", "2026-09-28T12:00:00.000Z")).toBe("Revoke Renown credential cred-1 at 2026-09-28T12:00:00.000Z");
  });
  it("profile message hashes the payload and lowercases the address", async () => {
    const m = await profileMessage("0xABC0000000000000000000000000000000000001", { username: "frank" }, "t");
    expect(m).toMatch(/^Update Renown profile 0xabc0000000000000000000000000000000000001 [0-9a-f]{64} at t$/);
    expect(await profileMessage("0xabc0000000000000000000000000000000000001", { username: "frank", userImage: null }, "t")).toBe(m);
    expect(await profileMessage("0xabc0000000000000000000000000000000000001", { username: "other" }, "t")).not.toBe(m);
  });
  it("timestamps must be within ±10 min", () => {
    expect(isFreshTimestamp(now.toISOString(), now)).toBe(true);
    expect(isFreshTimestamp(new Date(now.getTime() - SIGNATURE_WINDOW_MS - 60_000).toISOString(), now)).toBe(false);
    expect(isFreshTimestamp(new Date(now.getTime() + SIGNATURE_WINDOW_MS + 60_000).toISOString(), now)).toBe(false);
    expect(isFreshTimestamp("not a date", now)).toBe(false);
  });
  it("verifies personal_sign for the right address only; garbage is false", async () => {
    const a = privateKeyToAccount(generatePrivateKey()), b = privateKeyToAccount(generatePrivateKey());
    const message = revokeMessage("c", now.toISOString());
    const sig = await a.signMessage({ message });
    expect(await verifySignedMessage({ address: a.address, message, signature: sig })).toBe(true);
    expect(await verifySignedMessage({ address: b.address, message, signature: sig })).toBe(false);
    expect(await verifySignedMessage({ address: a.address, message, signature: "0x1234" })).toBe(false);
  });
});
describe("rate limiter", () => {
  it("allows `limit` per window per key", () => {
    const rl = createRateLimiter(2, 60_000);
    expect(rl.take("a", 0)).toBe(true); expect(rl.take("a", 1)).toBe(true); expect(rl.take("a", 2)).toBe(false);
    expect(rl.take("b", 2)).toBe(true); expect(rl.take("a", 60_001)).toBe(true);
  });
});
```

Also port the draft's `validateStructure` test cases (valid credential, wrong
proof type, oversized strings and arrays, future issuance date beyond the skew,
disallowed chain id). Build the credentials with `@renown/sdk` exactly as the
draft's `resolvers.test.ts` does.

- [ ] **Step 2: Run the tests and confirm they fail.**
  Run: `pnpm vitest run subgraphs/renown-auth`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement.**
  - `signed-message.ts`: `sha256hex` via `crypto.subtle`; `verifyMessage` from `viem` wrapped in try/catch.
  - `isFreshTimestamp`: `Date.parse`, not NaN, and `|now − t| ≤ SIGNATURE_WINDOW_MS`.
  - `rate-limit.ts`: a `Map<key, number[]>` of timestamps pruned to the window.
  - `credential-input.ts`: port the draft verbatim, adjusting imports.
  - `issuerAddressOf` parses `input.issuer.id` (`did:pkh:eip155:<chain>:<addr>`) with `parsePkhDid` from `@renown/sdk`.
- [ ] **Step 4: Run and confirm PASS; then `pnpm lint && pnpm tsc`.**
- [ ] **Step 5: Commit** `feat(renown-auth): credential validation, signed messages, rate limit`.

### Task 2: `renown-auth` subgraph and resolvers

**Files:**
- Create: `subgraphs/renown-auth/{index.ts,schema.ts,resolvers.ts,lookups.ts}`
- Modify: `subgraphs/index.ts` (register it; it is generated — use `pnpm generate subgraph --name renown-auth` first), `powerhouse.manifest.json`
- Test: `subgraphs/renown-auth/tests/resolvers.test.ts`

**Interfaces:**
- Consumes: everything from Task 1; document creators `actions.init/revoke`
  (renown-credential) and `setEthAddress/setUsername/setUserImage`
  (renown-user) from `document-models/*/v1`; read models
  `RenownCredentialProcessor` (`renown_credential` table: `credential_id`,
  `document_id`, the issuer address column — check `processors/renown-credential/schema.ts`)
  and `RenownUserProcessor` (`renown_user`: `document_id`, `eth_address`, `updated_at`).
- Produces: the three mutations, with the exact GraphQL signatures from Global
  Constraints. The schema reuses the draft's `RenownCredential_*` input-prefix
  trick so it merges with the generated types.
- `lookups.ts`:
  - `findCredentialDoc(db, credentialId): Promise<{documentId: string; issuerAddress: string; revoked: boolean} | undefined>`
  - `findNewestProfileDoc(db, address): Promise<string | undefined>` (case-insensitive, newest `updated_at`)

**Authorization helper (in resolvers.ts):**
```ts
async function authorizeAddress(ctx: { user?: { address?: string } }, expected: string, signed?: { message: string; signature?: string; timestamp?: string }, now = new Date()): Promise<void> {
  const want = expected.toLowerCase();
  if (ctx.user?.address && ctx.user.address.toLowerCase() === want) return;
  if (signed?.signature && signed.timestamp && isFreshTimestamp(signed.timestamp, now)
      && await verifySignedMessage({ address: want, message: signed.message, signature: signed.signature })) return;
  throw new GraphQLError("Forbidden", { extensions: { code: "FORBIDDEN" } });
}
```

**Resolver behaviour:**
- **`renown_issueCredential`:**
  1. `validateCredentialInput`, then `verifyCredentialSignature`; a failure
     throws "Invalid request: …".
  2. Rate limit on `issuerAddressOf(input)`; over the limit throws
     "Rate limited".
  3. If `findCredentialDoc` finds it, return that document id.
  4. Otherwise `createEmpty` (renown-credential) and `execute(init(input))`.
  5. Then, **only if `findNewestProfileDoc(issuer)` is undefined**, create a
     renown-user document with `setEthAddress(issuer)` plus
     `setUsername`/`setUserImage` when given.
  6. Return the credential document id.
- **`renown_revokeCredential`:**
  1. Look the credential up; not found throws "Not found".
  2. Authorize with `authorizeAddress(ctx, cred.issuerAddress, {message: revokeMessage(credentialId, timestamp), signature, timestamp})`.
  3. If already revoked, return `true`.
  4. Otherwise execute `revoke({ revokedAt: new Date().toISOString(), reason: "revoked by owner" })`
     (check the REVOKE input shape in the renown-credential model) and return `true`.
- **`renown_upsertProfile`:**
  1. Authorize with `authorizeAddress(ctx, address, {message: await profileMessage(address, {username, userImage}, timestamp), signature, timestamp})`.
  2. Find the newest profile document, or create one with `setEthAddress`.
  3. Apply `setUsername`/`setUserImage` for the fields that are provided.
  4. Return the document id.
- Every `execute` result is checked for operation `.error`, and throws if any
  operation failed.

- [ ] **Step 1: Write the failing tests.** Use a fake `reactorClient` (records
  `createEmpty`/`execute` and returns documents with ids), a fake `db`
  (in-memory rows behind the processors' `query()`), and real viem accounts
  and SDK-signed credentials. The cases must include:
  - issue creates the credential plus the first profile with username
  - issue is idempotent
  - **a replayed credential with a different username leaves the profile untouched** (Review Focus 1)
  - a bad signature is rejected
  - the rate limit
  - revoke by the issuer's token (`ctx.user.address` = issuer) and by the
    issuer's signature
  - **revoke by another wallet, a stale timestamp, a future timestamp, and a
    token for another address, all FORBIDDEN** (Review Focus 2 and 3)
  - revoking an already revoked credential returns true
  - upsert by token and by signature
  - upsert with a signature over a different payload is FORBIDDEN
  - upsert updates the newest existing profile and never creates a duplicate
- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement** the schema, the resolvers and the lookups. Register
  the subgraph (`index.ts` exports only the class).
- [ ] **Step 4: Run** `pnpm test && pnpm lint && pnpm tsc && pnpm build`.
  Expected: PASS, and `dist/node/subgraphs/index.mjs` mentions `renown-auth`.
- [ ] **Step 5: Commit** `feat(renown-auth): self-authenticating issue, revoke and profile mutations`.

### Task 3: Remove the unchecked `RenownUser_*` mutations

**Files:**
- Modify: `subgraphs/renown-user/{schema.ts,resolvers.ts}`: drop the `Mutation` type and resolvers, keep the queries.
- Test: `subgraphs/renown-user/tests/*` (update or remove the mutation tests); add a schema test asserting there is no `Mutation` type.

- [ ] **Step 1:** Write the failing schema test.
- [ ] **Step 2:** Run it and confirm it fails.
- [ ] **Step 3:** Remove the mutations.
- [ ] **Step 4:** `pnpm test && pnpm lint && pnpm tsc && pnpm build` passes.
- [ ] **Step 5:** Commit `fix(renown-user): remove unauthenticated profile mutations`.
- [ ] **Step 6:** Push, open a PR, wait for its checks, merge, and release:
  - `gh workflow run sync-and-publish.yml -R powerhouse-inc/renown-package --ref main -f channel=latest -f sync=false`, then watch it.
  - The deploy job bumps the `tenants/renown` switchboard and connect tags.
  - **Before the pod rolls**, check `pg_stat_activity` for long
    `idle in transaction` sessions.
  - Watch the rollout. It uses Recreate, so the switchboard is briefly down.

### Task 4: Phase 1 flags on the Renown switchboard

**Files:** Modify `powerhouse-k8s-hosting/tenants/renown/powerhouse-values.yaml` (switchboard env): add `RESOLVE_CALLER_IDENTITY: "true"` and `RENOWN_SOURCE: "self"`.

- [ ] **Step 1:** Local check first. Run the released image locally with those
  two flags on a fresh DB, and confirm:
  - anonymous `renownCredentials` works
  - a valid login token resolves `ctx.user` (upsert by token works)
  - a malformed token 401s
  - generic mutations still work (the policy is still OPEN)
- [ ] **Step 2:** Commit and push to k8s-hosting `main` via PR. Merge after
  review; the repo has no CI.
- [ ] **Step 3:** Watch the rollout, then smoke-test live:
  - GraphQL returns 200.
  - The prod-smoke flows (`renown-e2e/tools/flows.mjs` pattern, throwaway
    wallet) pass: 20/20.
  - `renown_issueCredential` with a throwaway credential returns an id.
  - `renown_revokeCredential` with its signature returns true.

## Part B: SDK and clients (phase 2)

### Task 5: `@renown/sdk` uses the new mutations

**Repo:** `/home/f/projects/powerhouse`. Create branch `feat/renown-write-auth-sdk`
from `origin/feat/renown-credential-issuance-sdk`, then `git rebase origin/main`.

**Files:** `packages/renown/src/{switchboard.ts,common.ts,index.ts}`, `packages/renown/test/{switchboard,signin}.test.ts`

**Behaviour:**
- **`issueCredential`:** keep the branch's `renown_issueCredential` call and
  its schema-error fallback.
- **`upsertUserProfile(address, profile, { token } | { signature, timestamp })`:**
  calls `renown_upsertProfile`. It falls back to the legacy generic path only
  on an unknown-schema error.
- **`revokeCredential(credentialId, opts)`:** calls `renown_revokeCredential`,
  with the same fallback.
- **`Renown.signIn` profile write:** passes the login token, as in the branch.
- **New exports:** the message helpers `revokeMessage`, `profileMessage`
  (identical strings to renown-package Task 1), so the Renown app and the
  scripts can sign.

**Steps:**
- [ ] **Tests (failing first):** each method sends the right mutation,
  variables and `Authorization` header, and falls back on an unknown-schema
  error. A resolver rejection (e.g. "Forbidden") does **not** fall back, and
  rethrows.
- [ ] **Implement** until `pnpm --filter @renown/sdk test` passes, plus lint and typecheck.
- [ ] **Commit, push, PR, and release.**
  - Find the monorepo's release path in `.github/workflows` (dev channel).
    Merge to the branch that publishes `6.2.3-dev.N`, after checks pass.
  - Record the published version as `SDK_VERSION` in the ledger.

### Task 6: Renown app uses the new mutations

**Repo:** `/home/f/projects/renown`. Create worktree `../renown-writeauth` from `origin/main`.

**Files:**
- `services/renown-credential.ts`
- `pages/api/credential/renown.ts`
- `pages/api/auth/credential.ts` (DELETE)
- `hooks/auth.ts` (logout revoke)
- `components/auth/credential.tsx` (revoke button)
- `services/wallet/renown-api.ts`
- `package.json` (`@renown/sdk` → `SDK_VERSION`)
- tests in `e2e/` (API-level Playwright `request` tests)

**Behaviour:**
- **POST `/api/credential/renown`:** calls `renown_issueCredential({input, username, userImage})`.
  It no longer writes documents directly.
- **DELETE `/api/credential/renown`:** requires `{credentialId, signature, timestamp}`
  in the body. The client signs `revokeMessage`. The route calls
  `renown_revokeCredential`, returns 401 without a signature, and relays 403.
- **DELETE `/api/auth/credential?id=`:** the same. Without a signature it
  returns 401. It maps a document id to a credential id by read-model lookup.
- **Client:** the revoke and logout paths sign `revokeMessage` with
  `session.signer.signMessage` before calling DELETE.
- **Profile edits** (if any UI exists) sign `profileMessage` and call
  `renown_upsertProfile`.
- **Reads:** the GET routes stay unchanged.

**Steps:**
- [ ] **Tests (failing first):** `request.delete` without a signature returns
  401. A stubbed switchboard (`page.route`, or a tiny local stub via
  `webServer`) receives `renown_revokeCredential` with the signature. POST
  sends `renown_issueCredential`.
- [ ] **Implement**, then `pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm build`
  and the e2e tests.
- [ ] **Commit, PR, merge** after checks; semantic-release publishes the image.
  - Bump the `tenants/renown` app tag in k8s-hosting.
  - **Vercel:** confirm `www.renown.id` deploys this commit. Fetch its
    `/oidc/login` page (new since 1.16.0) and a route changed here, and compare
    the build id. If Vercel does not auto-deploy from `main`, stop and ask the
    human, noting it in the ledger.

### Task 7: vetra.io on the new SDK

- [ ] **Bump the dependencies on `main`:** `@renown/sdk` (and
  `@powerhousedao/reactor-browser` if it pins the SDK) to `SDK_VERSION`, via
  `pnpm up`. Check that the lockfile keeps its integrity hashes.
  - Run `pnpm tsc --noEmit`, `pnpm lint` and `pnpm test:unit`; the 3 known
    failures are acceptable.
  - PR, merge after checks, and CI deploys prod.
- [ ] **Cherry-pick to `staging`** as a PR, merge after checks, and CI deploys
  staging.
- [ ] **Live smoke test:** staging.vetra.io and vetra.io return 200. A scripted
  in-page sign-in isn't possible without a wallet, so the Task 11 local run
  covers it.

### Task 8: pfnur portal and scripts on the new SDK

**Repo:** `/home/f/projects/pfnur-toll-collect-portal`

- [ ] **Bump the catalog:** `@renown/sdk` and `@powerhousedao/reactor-browser`
  in `pnpm-workspace.yaml` to `SDK_VERSION`.
- [ ] **`scripts/worker-identity.mjs`:**
  - Issuance goes through the SDK, which now calls `renown_issueCredential`.
  - `--revoke` signs `revokeMessage` with the ceremony's eth key and calls
    `revokeCredential(id, {signature, timestamp})`.
- [ ] **e2e stub:** teach `e2e/setup/renown-switchboard.ts` the three mutations,
  mirroring the renown-package behaviour, and update the e2e helpers.
- [ ] **Checks:** run the repo's test, e2e, lint and build scripts (see its
  package.json and CI).
- [ ] **Deploy:** PR, merge after checks, and CI builds the images.
  - Bump the pfnuer-**dev** portal image tag in `tenants/pfnuer-dev/extras/*`,
    then verify: portal returns 200, and a login smoke test runs if the e2e
    suite can target dev.
  - Then pfnuer-**prod** (toll-hunter.com).

### Task 9: vetra-cli provisioning

- [ ] **`scripts/publish/provision-credential.mjs`:** call `renown_issueCredential`
  with the signed credential. Remove the raw `createEmptyDocument` and legacy
  `mutateDocument`.
- [ ] **Test** against a local Renown switchboard (the Task 4 local image).
- [ ] **Deploy:** PR, merge after checks.

## Part C: Gate, flip, verify

### Task 10: Environment baseline script (phase 0; run before Task 4 goes live)

**Files:** `powerhouse-k8s-hosting/scripts/renown-env-probe.mjs`

**What it checks:** it enumerates the ArgoCD applications and the tenant values
(`kubectl -n argocd get applications -o json`, plus
`tenants/*/powerhouse-values.yaml` and the tenant repos). For each environment
it records JSON:
- Connect `/` status and the runtime-config Renown URL.
- Switchboard `/graphql` `{__typename}` status.
- For environments whose switchboard sets `AUTH_ENABLED` or
  `RESOLVE_CALLER_IDENTITY`: whether a given login token (flag
  `--bearer <token>`) is accepted by an identity-requiring query. Use the
  cheapest query that fails for an invalid token. Probe it once against the
  vetra prod switchboard to choose one.
- Registry `/-/whoami` with the token.
- Renown app REST on both deployments (`/api/switchboard`,
  `/api/auth/credential?address=`).
- OIDC discovery.

Flag `--compare <baseline.json>` diffs the results.

- [ ] Write the script, run it (without `--bearer`) to produce `baseline-phase0.json`
  in the scratchpad, and commit the script.

### Task 11: Local gate with the phase 3 flags (must pass before Task 12)

Run everything locally:
- a fresh prod-DB copy (Global Constraints)
- the Renown switchboard image from Task 3 with phase 1 **and** phase 3 flags
- the Renown app from Task 6

Every item in the spec's "Local gate" list must pass (items 1–10), using:
- the Task 5 SDK
- the Connect and switchboard versions listed in the spec (run their images or
  published packages locally)
- the pfnur portal from Task 8 (its e2e suite pointed at the local Renown)
- vetra.io from Task 7 (local dev, pointed at the local Renown)

Record a pass/fail matrix in the ledger. **Any fail blocks Task 12.**

### Task 12: Flip and verify every environment

- [ ] **Flip:** add `AUTH_ENABLED` and `ADMINS` (Global Constraints) to
  `tenants/renown`, via PR. Check `pg_stat_activity` first. Merge and watch the
  rollout.
- [ ] **Mint a throwaway credential and login token** on production via
  `renown_issueCredential`.
- [ ] **Probe:** run `renown-env-probe.mjs --bearer <token> --compare baseline-phase0.json`,
  plus the prod-smoke flows (20/20), the OIDC check, and the negative checks
  (anonymous `createEmptyDocument` / `execute` / `RenownCredential_revoke` are
  denied).
- [ ] **Clean up:** revoke the throwaway credential with its signature.
- [ ] **On any regression:** revert the flip commit immediately, record it,
  then investigate.
- [ ] **Record memory:** a reference memory for Renown write authorization
  (flags, mutations, messages, rollout, rollback).
