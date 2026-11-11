# Workload tokens for every branch, release rights for listed ones

Date: 2026-11-11. Status: approved design. Repos: `renown-package` (this change), `vetra-cloud-package` (follow-up, section 6).

## 1. Why

Vetra's new release model (vetra-cloud-package `docs/superpowers/specs/2026-11-11-app-releases-and-instances-design.md`) publishes from more than one branch:

- `main`: releases and `-main.N` builds;
- `next` (or any prerelease branch): `2.0.0-beta.N` releases;
- `1.x` (maintenance branches): patches for an old major;
- any feature branch: builds for branch instances.

Today a workload identity has one `productionBranch`, and `classifyRun` (`subgraphs/renown-workload/core/refs.ts`) issues a token only for that branch (`PRODUCTION`), `v*` tags (`RELEASE`) and pull requests (`PREVIEW`). A push to `next` gets 403 "Only push/workflow_dispatch on the production branch, …".

## 2. What changes

1. A new ref class `BRANCH`: a `push` or `workflow_dispatch` run on any branch other than the production branch.
2. A new identity field `releaseBranches`: the branches (exact names or simple patterns) that may publish releases.
3. The production registry audience is allowed for `BRANCH` runs only on a listed release branch.
4. The `vetra` claim gains `releaseBranch: boolean`.

Unchanged: `PRODUCTION`, `RELEASE` and `PREVIEW` classify and authorise exactly as today. Events that may run fork code (`pull_request_target`, `workflow_run`, `issue_comment`, …) stay untrusted for every branch.

## 3. Classification

`classifyRun(eventName, ref, productionBranch)` keeps its signature and order:

| Event | Ref | Class |
|---|---|---|
| `push`, `workflow_dispatch` | `refs/heads/<productionBranch>` | `PRODUCTION` |
| `push` | `refs/tags/v<digit>…` | `RELEASE` |
| `pull_request` | `refs/pull/<n>/merge` | `PREVIEW` |
| `push`, `workflow_dispatch` | any other `refs/heads/<branch>` | `BRANCH` (new) |
| anything else | | untrusted (null) |

A branch name in the ref is accepted for `BRANCH` only if it passes the same validation as `productionBranch` (`validateProductionBranch` rules: allowed characters, no `..`, no leading `-`/`/`, no trailing `/`, `.`, `.lock`, ≤ 255).

`isReleaseBranch(branch, productionBranch, releaseBranches)` (new, `core/refs.ts`): true for the production branch and for any branch matching an entry of `releaseBranches`.

## 4. Release branch patterns

- An entry is an exact branch name, or a pattern in which `*` matches one or more characters other than `/` (`*.x` matches `1.x`, `release/*` matches `release/2.0`, not `release/2.0/rc`).
- No other glob syntax (`?`, `**`, `[…]`, `{…}`). An entry with `*` removed must still be a valid branch name.
- At most 20 entries, each ≤ 255 characters, duplicates removed, stored in the order given.
- Validation errors are `BAD_USER_INPUT` with the offending entry named, as for `productionBranch`.

## 5. Audiences and the claim

`isAudienceAllowed(refClass, audience, allowlist, { releaseBranch })`:

| Class | Production registry (`https://registry.vetra.io`) | Other allowlisted audiences (Vetra apps, …) |
|---|---|---|
| `PRODUCTION`, `RELEASE` | allowed | allowed |
| `BRANCH`, release branch | allowed | allowed |
| `BRANCH`, other branch | refused | allowed |
| `PREVIEW` | refused | allowed |

The `vetra` claim (`VetraWorkloadClaim`) gains `releaseBranch: boolean`: true for `PRODUCTION`, for `BRANCH` on a release branch, false otherwise (`RELEASE` tags and `PREVIEW`: false). `refClass` carries `"BRANCH"` for the new class.

The refusal message for untrusted runs changes to "Only push/workflow_dispatch on a branch, push of v* tags and pull_request runs get a token".

## 6. Storage and API

- Migration: `workload_identities.release_branches text not null default '[]'` (JSON array), added with `ADD COLUMN IF NOT EXISTS` in the existing migration style. Existing identities get `[]`: behaviour for them changes only in that their other branches now get `BRANCH` tokens for non-registry audiences.
- Store types (`store/types.ts`, memory and Kysely stores): `releaseBranches: string[]`.
- GraphQL (`schema.ts`):
  - `WorkloadIdentity.releaseBranches: [String!]!`
  - `RegisterWorkloadIdentityInput.releaseBranches: [String!]` (optional, default `[]`)
  - `updateWorkloadIdentity(did, repository, productionBranch, releaseBranches: [String!])`: when given, replaces the list (`[]` clears it).
- The registration-token auth on these fields is unchanged.

## 7. Vetra's side (vetra-cloud-package follow-up)

- App settings gain `releaseBranches` (default `[]`), edited next to the production branch; Vetra is the source of truth and writes it to Renown with `updateWorkloadIdentity` whenever it changes (and on registration).
- `releases/claim.ts` `assertReportAllowed`: a `release` additionally requires the branch to be the production branch or to match the app's own `releaseBranches` (same matcher semantics as section 4), and `claim.releaseBranch === true`. Builds stay allowed from any branch.
- The generated `vetra.yml` triggers on `push` to all branches (`branches: ['**']`) plus pull requests.
- The old deploy path is untouched: it deploys only on `refClass` `PRODUCTION`/`PREVIEW`, so a `BRANCH` token cannot deploy.

## 8. Rollout

0. Vetra first: the section 7 release-branch check (and `releaseBranch` claim requirement) ships to Vetra before Renown's production release, see step 2.
1. Renown: ship to staging (`1.13.x-staging`), verify a `next` push gets a `BRANCH` token for the Vetra audience and a 403 for the registry; set `releaseBranches: ["next"]` on a test identity and verify the registry token is issued with `releaseBranch: true`. Then production.
2. Vetra: ship all of section 7 in one release. Ordering matters: Vetra's release server (0.0.105) checks the branch from the claim but not whether it is a release branch, so once Renown issues `BRANCH` tokens, a push to any branch could report a release. Ship the section 7 release-branch check to Vetra before or together with step 1's production release of Renown.
3. Staging and production share Renown, so step 1's production release affects both platforms at once; `BRANCH` tokens only add capability, nothing existing is withdrawn.

## 9. Tests

- `core/refs.ts`: every row of the section 3 table, fork events on non-production branches stay null, invalid branch names in refs, `isReleaseBranch` with exact names and patterns (`*.x`, `release/*`, non-matching nested paths).
- Pattern validation: accepted and refused entries, the 20-entry cap, dedupe.
- `isAudienceAllowed`: every row of the section 5 table.
- Handler (`http/handlers.ts`, exchange tests): a `next` push without a list gets a Vetra-audience token with `refClass: "BRANCH"`, `releaseBranch: false`, and 403 for the registry; with `releaseBranches: ["next"]` the registry token is issued and `releaseBranch: true`.
- Store contract (memory and Kysely): `releaseBranches` round-trips; the migration adds the column with `[]` for existing rows.
- GraphQL: register with and without the list, update replaces and clears it, validation errors.

## 10. Out of scope

- Per-branch audiences beyond the registry rule above.
- Tag patterns other than `v*`.
- Any change to org policy (frozen, disabled) — it applies to `BRANCH` runs exactly as to the others.
