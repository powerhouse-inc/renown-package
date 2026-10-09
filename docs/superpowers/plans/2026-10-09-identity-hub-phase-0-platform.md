# Identity Hub — Phase 0 (Platform) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Renown runs Powerhouse 6.2.3 with S3-backed attachments, on a real staging stack (`renown-staging`) that Vetra staging talks to, and releases can no longer leak staging builds into prod.

**Architecture:** renown-package is bumped to 6.2.3 and its release workflow learns per-channel deploy targets (staging → `tenants/renown-staging`, latest → `tenants/renown`) with a pinned `ph-cmd`. A new `renown-staging` tenant in `powerhouse-k8s-hosting` mirrors prod with its own DB, bucket and secrets. renown.id builds a `staging` image. Vetra staging is repointed at Renown staging.

**Tech Stack:** pnpm, Powerhouse 6.2.3 (ph-cli/ph-cmd), GitHub Actions, Helm (`powerhouse-chart`), ArgoCD + image updater, OpenBao + ExternalSecrets, Hetzner Object Storage (`mc`), Next 16 (renown.id).

**Spec:** `/home/f/projects/renown-package-hub/docs/superpowers/specs/2026-10-09-renown-identity-hub-design.md` (Phase 0)

## Global Constraints

- Staging first, then prod.
- No `Co-Authored-By` / "Generated with" trailers in commits or PRs.
- Never print or paste secret values; move them OpenBao → ExternalSecret (`bao kv put … @file`/piped, never echoed).
- Never edit `gen/` folders.
- `BAO_ADDR=https://openbao.vetra.io`; KV mount `kv/`.
- Repos/worktrees: renown-package → `/home/f/projects/renown-package-hub` (branch `feat/identity-hub`); renown.id → `/home/f/projects/renown-hub` (branch `feat/identity-hub`); hosting → `/home/f/projects/powerhouse-k8s-hosting` (branch `main`, push directly — ArgoCD syncs).
- S3: endpoint `https://nbg1.your-objectstorage.com`, region `nbg1`, path-style, credentials `kv/powerhouse/shared/s3-credentials` (`ACCESS_KEY_ID`, `SECRET_ACCESS_KEY`), buckets `renown-staging-attachments` / `renown-attachments`, prefix `attachments`, private.

## Review Focus

1. A staging release must never change `tenants/renown/powerhouse-values.yaml` or be picked up by the prod image updater — Task 1 + Task 2 tests pin both.
2. `latest` channel images must install `ph-cmd` at the exact pinned Powerhouse version, not `@dev` — Task 2 asserts the computed build arg.
3. Staging switchboard boots on an **empty** database with all renown subgraphs (auth, oidc, read-model, stats, workload) registered — Task 4 verification.
4. An attachment upload (reserve → PUT) against staging returns an `attachment://v1:` ref and the object lands in `renown-staging-attachments` — Task 5.
5. Vetra staging still logs users in and its deploy auth still works after repointing — Task 6 verification includes re-registering one staging app identity.

---

### Task 1: Stop prod Renown from auto-deploying staging tags

**Files:**
- Modify: `/home/f/projects/powerhouse-k8s-hosting/argocd-apps/tenants/powerhouse-renown.yaml` (allow-tags lines)

**Interfaces:** Produces: prod image updater only accepts `^v\d+\.\d+\.\d+$`.

- [ ] **Step 1:** Replace both allow-tags annotations with stable-only:

```yaml
    # Stable releases only; staging builds deploy to renown-staging.
    argocd-image-updater.argoproj.io/switchboard.allow-tags: "regexp:^v[0-9]+\\.[0-9]+\\.[0-9]+$"
    argocd-image-updater.argoproj.io/connect.allow-tags: "regexp:^v[0-9]+\\.[0-9]+\\.[0-9]+$"
```

- [ ] **Step 2:** `kubectl -n argocd get application powerhouse-renown -o jsonpath='{.metadata.annotations}' | grep allow-tags` after root-app sync shows the new regex (hard-refresh `root-app` if needed).
- [ ] **Step 3:** Commit `fix(renown): image updater takes stable tags only` and push.

### Task 2: renown-package → Powerhouse 6.2.3, pinned ph-cmd, per-channel deploy

**Files:**
- Modify: `package.json` (all `@powerhousedao/*`, `document-model`, `document-drive` → `6.2.3`), `pnpm-lock.yaml`
- Modify: `.github/workflows/sync-and-publish.yml` (steps "Determine ph-cmd tag", job `deploy`)
- Create: `scripts/ci/deploy-target.sh`, `scripts/ci/deploy-target.test.sh`
- Modify: any source/test that breaks under 6.2.3 (fix forward; never edit `gen/` by hand — re-run `pnpm generate`/`ph generate` if codegen output changed)

**Interfaces:** Produces: `scripts/ci/deploy-target.sh <channel>` prints the values path (`tenants/renown-staging/powerhouse-values.yaml` for `staging`, `tenants/renown/powerhouse-values.yaml` for `latest`, nothing + exit 0 for `dev`); ph-cmd build arg = exact `@powerhousedao/ph-cli` version from package.json.

- [ ] **Step 1: failing test** `scripts/ci/deploy-target.test.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
d="$(dirname "$0")"
[ "$("$d/deploy-target.sh" staging)" = "tenants/renown-staging/powerhouse-values.yaml" ]
[ "$("$d/deploy-target.sh" latest)" = "tenants/renown/powerhouse-values.yaml" ]
[ -z "$("$d/deploy-target.sh" dev)" ]
if "$d/deploy-target.sh" bogus 2>/dev/null; then echo "bogus must fail"; exit 1; fi
echo ok
```

Run `bash scripts/ci/deploy-target.test.sh` → fails (script missing).

- [ ] **Step 2: implement** `scripts/ci/deploy-target.sh`:

```bash
#!/usr/bin/env bash
# Values file a release channel deploys to. dev deploys nowhere.
set -euo pipefail
case "${1:-}" in
  staging) echo "tenants/renown-staging/powerhouse-values.yaml" ;;
  latest)  echo "tenants/renown/powerhouse-values.yaml" ;;
  dev)     ;;
  *) echo "unknown channel: ${1:-}" >&2; exit 1 ;;
esac
```

`chmod +x` both; test passes.

- [ ] **Step 3: workflow.** In `docker` job replace "Determine ph-cmd tag" with:

```yaml
      - name: Determine ph-cmd version
        id: ph-tag
        run: |
          # Pin ph-cmd to the Powerhouse version the package is built against,
          # so images never float on a channel dist-tag.
          V=$(node -p "require('./package.json').devDependencies?.['@powerhousedao/ph-cli'] ?? require('./package.json').dependencies?.['@powerhousedao/ph-cli']")
          V="${V#^}"; V="${V#~}"
          [ -n "$V" ] && [ "$V" != "undefined" ] || { echo "no ph-cli pin"; exit 1; }
          echo "tag=$V" >> $GITHUB_OUTPUT
```

(Confirm the step runs after checkout; if `@powerhousedao/ph-cli` is not a dependency, use `@powerhousedao/reactor-api`'s version instead — same pin.) In `deploy` job: drop the static `VALUES_PATH` env, add a checkout of this repo, and at the top of the run block:

```bash
VALUES_PATH=$(bash scripts/ci/deploy-target.sh "${{ needs.prepare.outputs.channel }}")
if [ -z "$VALUES_PATH" ]; then echo "channel ${{ needs.prepare.outputs.channel }} does not deploy"; exit 0; fi
```

and use it in the `gh api` calls and the commit message (`deploy: update ${VALUES_PATH%%/powerhouse-values.yaml} to ${DEPLOY_VERSION}`).

- [ ] **Step 4: upgrade.** `pnpm up "@powerhousedao/*@6.2.3" document-model@6.2.3 document-drive@6.2.3` (exact pins, no caret), `pnpm install`, then `pnpm tsc` (or the repo's typecheck script), `pnpm lint`, `pnpm test`, `pnpm build`. Fix failures at their cause. Record notable fallout in the report.
- [ ] **Step 5:** `actionlint .github/workflows/sync-and-publish.yml` if available (else `npx --yes action-validator` or yaml parse) passes.
- [ ] **Step 6:** Commit `chore: powerhouse 6.2.3, pinned ph-cmd, per-channel deploy target`.

### Task 3: renown.id → 6.2.3 + staging image

**Files:**
- Modify: `/home/f/projects/renown-hub/package.json` (`@powerhousedao/*` → `6.2.3`), lockfile
- Modify: `/home/f/projects/renown-hub/.github/workflows/semantic-release.yml` (push branches + tags)
- Modify: `/home/f/projects/renown-hub/.releaserc.json` only if needed so a `staging` branch push does not try to cut a main release

**Interfaces:** Produces: pushing branch `staging` publishes `cr.vetra.io/renown/renown-app:staging` and `:staging-<sha7>`.

- [ ] **Step 1:** Bump deps, `pnpm install` (or the repo's package manager), `pnpm build`, `pnpm lint`, `pnpm test` (Playwright; if browsers missing, `npx playwright install chromium`). Fix fallout at its cause.
- [ ] **Step 2:** Workflow: `on.push.branches: [main, staging]`. Semantic-release runs only on `main` (`if: github.ref_name == 'main'` on the release step). Image tags: on `staging` push `${VETRA_IMAGE}:staging` and `${VETRA_IMAGE}:staging-${GITHUB_SHA::7}` (compute in a step); on `main` keep current tags.
- [ ] **Step 3:** Commit `chore: powerhouse 6.2.3 and staging image`.

### Task 4: `renown-staging` tenant (controller-run infra)

**Files:**
- Create: `/home/f/projects/powerhouse-k8s-hosting/tenants/renown-staging/powerhouse-values.yaml`
- Create: `/home/f/projects/powerhouse-k8s-hosting/tenants/renown-staging/extras/00-attachment-s3-externalsecret.yaml` (+ ArgoCD wiring for extras if the renown app pattern needs it; else put the ExternalSecret through the chart's `extraExternalSecret`)
- Create: `/home/f/projects/powerhouse-k8s-hosting/argocd-apps/tenants/powerhouse-renown-staging.yaml`
- OpenBao: `kv/tenants/renown-staging/oidc` (copied from `kv/tenants/renown/oidc` server-side; `RENOWN_OIDC_REGISTRATION_TOKEN` and `RENOWN_WORKLOAD_REGISTRATION_TOKEN` regenerated with `openssl rand -hex 32`), plus `PH_ATTACHMENT_URL_SIGNING_SECRET` (`openssl rand -hex 32`).

- [ ] **Step 1: secrets** (no printing):

```bash
export BAO_ADDR=https://openbao.vetra.io
bao kv get -format=json kv/tenants/renown/oidc | jq '.data.data
  | .RENOWN_OIDC_REGISTRATION_TOKEN = $a | .RENOWN_WORKLOAD_REGISTRATION_TOKEN = $b
  | .PH_ATTACHMENT_URL_SIGNING_SECRET = $c' \
  --arg a "$(openssl rand -hex 32)" --arg b "$(openssl rand -hex 32)" --arg c "$(openssl rand -hex 32)" \
  | bao kv put kv/tenants/renown-staging/oidc - >/dev/null
bao kv get -format=json kv/tenants/renown-staging/oidc | jq -r '.data.data|keys|join(",")'
```

- [ ] **Step 2: bucket:** `mc alias set hetzner https://nbg1.your-objectstorage.com "$(bao kv get -field=ACCESS_KEY_ID kv/powerhouse/shared/s3-credentials)" "$(bao kv get -field=SECRET_ACCESS_KEY kv/powerhouse/shared/s3-credentials)" --api S3v4 --path on >/dev/null && mc mb --ignore-existing hetzner/renown-staging-attachments && mc anonymous get hetzner/renown-staging-attachments` → `private`.
- [ ] **Step 3: values** = copy of `tenants/renown/powerhouse-values.yaml` with: namespace-independent names unchanged except `database.cnpg.name: renown-staging-pg`, `bootstrap.database: renown_staging_db`, `owner: renown_staging_user`, `storageSize: 10Gi`, backup `destinationPath: s3://powerhouse-cnpg-backups/renown-staging/`; hosts `switchboard.renown-staging.vetra.io`, `connect.renown-staging.vetra.io`, `renown-staging.vetra.io` with their own TLS secret names; image tags `staging`→ set to the first staging release tag once Task 5 publishes (placeholder `v1.7.0` until then — prod's current image boots fine); `PUBLIC_URL`/`PH_SWITCHBOARD_PUBLIC_URL: https://switchboard.renown-staging.vetra.io`; `RENOWN_OIDC_LOGIN_URL: https://renown-staging.vetra.io/oidc/login`; app `GRAPHQL_ENDPOINT: https://switchboard.renown-staging.vetra.io/graphql` and `NEXT_PUBLIC_SWITCHBOARD_ENDPOINT` same; `sentry.environment: renown-staging`; `extraExternalSecret.key: tenants/renown-staging/oidc` with properties + `PH_ATTACHMENT_URL_SIGNING_SECRET`; switchboard `persistence.enabled: false` and env:

```yaml
    PH_ATTACHMENT_STORAGE: s3
    PH_ATTACHMENT_S3_ENDPOINT: https://nbg1.your-objectstorage.com
    PH_ATTACHMENT_S3_REGION: nbg1
    PH_ATTACHMENT_S3_BUCKET: renown-staging-attachments
    PH_ATTACHMENT_S3_FORCE_PATH_STYLE: "true"
    S3_ATTACHMENT_PREFIX: attachments
```

and the S3 key/secret env from an ExternalSecret mirroring `tenants/pfnuer-prod/extras/00-attachment-s3-externalsecret.yaml` (target secret `renown-staging-attachment-s3`, mapped to `PH_ATTACHMENT_S3_ACCESS_KEY_ID` / `PH_ATTACHMENT_S3_SECRET_ACCESS_KEY` the same way pfnuer-prod's values consume it).
- [ ] **Step 4: ArgoCD app** = copy of `powerhouse-renown.yaml` with name `powerhouse-renown-staging`, label `tenant: renown-staging`, namespace `renown-staging`, values `../tenants/renown-staging/powerhouse-values.yaml`, write-back target the staging values, allow-tags `regexp:^v[0-9]+\\.[0-9]+\\.[0-9]+-staging\\.[0-9]+$`; plus a second source/app for `extras/` if pfnuer uses one (`pfnuer-prod-extras.yaml` pattern).
- [ ] **Step 5:** Commit + push; hard-refresh `root-app`; wait for `renown-staging` pods Ready; verify `curl https://switchboard.renown-staging.vetra.io/graphql` `{__typename}` = 200 and `renownUsers` query answers `[]`.

### Task 5: Release renown-package + renown.id to staging, prove S3 uploads

- [ ] **Step 1:** renown-package: `git push origin feat/identity-hub:staging --force-with-lease` is NOT allowed (shared branch) — instead `git checkout -B staging origin/staging && git merge --ff-only origin/main || git merge origin/main` then merge `feat/identity-hub`, push `staging`; `gh workflow run sync-and-publish.yml -f channel=staging -f sync_dependencies=false`; watch; confirm the deploy job edited `tenants/renown-staging/powerhouse-values.yaml` only.
- [ ] **Step 2:** renown.id: push `feat/identity-hub` to a new `staging` branch; confirm `renown-app:staging-<sha>` exists; set the staging values app tag to it.
- [ ] **Step 3: upload proof** with a staging bearer (log into `renown-staging.vetra.io` via Connect at `connect.renown-staging.vetra.io`, copy the bearer from the browser — or use the switchboard admin flow): `POST /attachments/reservations` (`{fileName, mimeType, sizeBytes, sha256}` per 6.2.3 contract) → `PUT` bytes → expect `attachment://v1:<sha256>`; `mc ls hetzner/renown-staging-attachments/attachments/` shows the object. If a human bearer is required, ask the user to perform the login and paste nothing — run the curl with the token from a file they save.
- [ ] **Step 4:** Smoke: `/graphql` subgraphs present (`renownUser`, `appProfile`, `userStats`, `workloadIdentity`), switchboard logs free of boot errors.

### Task 6: Point Vetra staging at Renown staging

**Files:**
- Modify: `/home/f/projects/powerhouse-k8s-hosting/tenants/staging/powerhouse-values.yaml` (switchboard env + vetra.io app env)
- OpenBao: staging vetra secret that holds `RENOWN_WORKLOAD_REGISTRATION_TOKEN` (find the ExternalSecret key the staging values reference) ← new staging token.

- [ ] **Step 1:** Set on staging switchboard: `RENOWN_SWITCHBOARD_URL: https://switchboard.renown-staging.vetra.io`, `RENOWN_STATS_URL: https://switchboard.renown-staging.vetra.io/graphql/renown-stats`, and whatever env the reactor uses to verify Renown bearers/credentials (`grep -n RENOWN tenants/staging/powerhouse-values.yaml` + reactor-api `RENOWN_URL`); vetra.io staging: `NEXT_PUBLIC_RENOWN_URL: https://renown-staging.vetra.io` and `NEXT_PUBLIC_RENOWN_SWITCHBOARD_URL: https://switchboard.renown-staging.vetra.io/graphql`.
- [ ] **Step 2:** Copy the new staging `RENOWN_WORKLOAD_REGISTRATION_TOKEN` from `kv/tenants/renown-staging/oidc` into the vetra staging secret path (server-side pipe, no printing); restart staging switchboard.
- [ ] **Step 3: verify:** vetra.io staging login works (Renown staging popup), `/user/apps` lists apps; one staging app re-authorizes on Renown staging and a staging deploy token exchange succeeds (or `githubDeployAppInfo`/identity status shows ACTIVE).

### Task 7: Promote to prod

- [ ] **Step 1:** Prod bucket `renown-attachments` (`mc mb`, private); add `PH_ATTACHMENT_URL_SIGNING_SECRET` to `kv/tenants/renown/oidc` (patch, no printing); prod values get the same attachment env (bucket `renown-attachments`), `persistence.enabled: false`, `PH_SWITCHBOARD_PUBLIC_URL`, ExternalSecret for S3.
- [ ] **Step 2:** renown-package: merge `feat/identity-hub` into `main`, push, `gh workflow run sync-and-publish.yml -f channel=latest`; confirm deploy edited `tenants/renown` only and prod pods roll.
- [ ] **Step 3:** renown.id: merge `feat/identity-hub` into `main` (semantic-release cuts a version + image; Vercel deploys www.renown.id); bump prod app tag.
- [ ] **Step 4:** Prod smoke: subgraphs present; vetra.io prod login; one prod upload proof as in Task 5 Step 3; `renownUsers` count unchanged.
