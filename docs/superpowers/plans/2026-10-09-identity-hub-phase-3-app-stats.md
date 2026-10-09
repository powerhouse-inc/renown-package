# Identity Hub — Phase 3 (App Stats) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publishers declare the metrics their app reports (key, label, unit, aggregation, public) from the vetra.io Profile tab; environments report users' current values through Vetra's relay; Renown aggregates them per app and shows stat tiles, active users and top contributors on `renown.id/app/<did>`, a "Stats" section on user profiles and compact tiles on the vetra.io app overview — proven end to end on staging by a script.

**Architecture:** `renown-app-profile` gains a `metrics` list and a `metrics` module (four operations) additively in v1. renown-stats keeps one row per (app, metric, user) in a new `app_metric_values` table, written right after every accepted `reportUserStat` and filled once from the existing `renown-user-stats` documents by an idempotent background backfill; `appStats(appDid)` derives SUM/MAX/AVG/COUNT_USERS, active users (30 d) and the top 5 contributors (resolved through the Phase 1 `renown_user` read model) per query, exposing only public declared metrics. `upsertAppProfile` takes `metrics` (full replace) through the Phase 2 write gate, so vetra.io saves them via `vetraPublisher.updateAppProfile` on Vetra's switchboard. The relay path (environment → `vetraLicensing.reportUserStat` with `x-vetra-reporting-token` → Renown) already exists; this phase fixes the studio app's identity lookup, ships a dependency-free helper, documents it on vetra.io and proves it on staging from inside an environment pod.

**Tech Stack:** Powerhouse 6.2.3 (`ph-cli generate`), Kysely + PGlite, Vitest; renown.id: Next 16 pages router, Tailwind 4, Playwright with the stub switchboard; vetra.io: Next 16 app router, shadcn/ui, React Query, Vitest + happy-dom + Testing Library; vetra-cloud-package: Vitest + PGlite publisher harness, Node 24 (`--experimental-strip-types` scripts), kubectl.

**Spec:** `/home/f/projects/renown-package-hub/docs/superpowers/specs/2026-10-09-renown-identity-hub-design.md` (Phase 3, Global constraints). Builds on `/home/f/projects/renown-package-hub/docs/superpowers/plans/2026-10-09-identity-hub-phase-1-user-identity.md` (Phase 1) and `/home/f/projects/renown-package-hub/docs/superpowers/plans/2026-10-09-identity-hub-phase-2-app-profiles.md` (Phase 2). Every "Phase 2 text" anchor below is quoted from the Phase 2 plan; Phase 1 and Phase 2 code must be committed on the branches named in Global Constraints before Task 1 starts.

## Ruling needed

Decisions taken in this plan that differ from (or sharpen) the spec and the brief. Each has a default the plan implements; overrule before the named task starts.

1. **"Same transaction" is not possible; default: write-after under the same lock.** (Task 4.) The stat lives in a reactor document; `app_metric_values` lives in the `renown-stats` relational namespace — two stores, no shared transaction. Default: inside `reportUserStat`'s existing per-user lock, the aggregate row is upserted immediately after the document operation is accepted (or after the unchanged-value short-circuit). A crash between the two leaves one row stale until that user's next report of the metric (every report, changed or not, rewrites the row) — and the rows are guarded "newer `updated_at` wins", so the backfill can never overwrite a live value.
2. **`updated_at` = time of the last accepted report, changed value or not.** (Tasks 2, 4.) So `activeUsers30d` means "the app reported anything about this user in the last 30 days". The document's own `updatedAt` keeps its meaning (last change). Backfilled rows take the document's `updatedAt`.
3. **`userStats` hides metrics the publisher declared non-public.** (Task 5.) Undeclared metrics are still returned (without label) so the existing contract keeps working; the profile UI shows only entries that carry a label (declared and public). `appStats` returns declared public metrics only, as specified.
4. **API shape beyond the spec text.** (Task 5.) `MetricContributor` carries the resolved profile (`address, handle, displayName, documentId, hasAvatar, userImage`) besides `userDid, value`; `AppStats` adds `appDid`; `AppMetricStat` adds `description`; `updatedAt` is an ISO `String` (like `UserStat.updatedAt`), not a `DateTime` scalar. `appStats` is `null` only when the app has neither a profile nor any reported value. `UserStat` gains `appName, appDocumentId, appHasLogo, appLogo, label, unit`.
5. **Model errors beyond `DuplicateMetricKeyError`.** (Task 1.) `TooManyMetricsError`, `DuplicateMetricIdError`, `InvalidMetricError` (key/label/unit/description rules) on `ADD_METRIC` (also thrown by `UPDATE_METRIC`), `MetricNotFoundError` on `UPDATE_METRIC` (also thrown by `REMOVE_METRIC`/`REORDER_METRICS`); `REORDER_METRICS` moves the listed ids to the front (Phase 2's link rule). The reducer trims label/unit/description; `""` unit/description means none. The write path turns a **key change** into `REMOVE_METRIC` + `ADD_METRIC` with the same id, so two metrics can swap keys in one save.
6. **Helper location: a dependency-free single file, documented on vetra.io, canonical tested copy in vetra-cloud-package `shared/report-user-stat.ts` — not a package export.** (Tasks 8, 11.) Environments run arbitrary publisher packages; depending on `@powerhousedao/vetra-cloud-package` would pull a whole reactor package (models, editors, subgraphs) into theirs, and `ph-cli build` owns the package's export map. A new npm package for ~60 lines is not worth a publish pipeline yet. vetra.io shows the file verbatim (copy-paste), like Phase 2's markdown parser copy.
7. **Only licensed DEDICATED environments can report, and only their holder's own stats (unchanged relay rule).** (Tasks 11, 15.) An app's own production/preview environments get no reporting token, so a multi-user SHARED app cannot yet report for its users through Vetra. Changing that (tokens for production environments, any-user relay for them) is a new trust decision; listed as follow-up F2 and stated on the docs page.
8. **The studio app's Renown identity comes from its ledger-checked document.** (Task 7.) The relay reads the app DID from the `apps` row only, and Vetra Studio (licensing-only) has none, so every studio environment's report is refused ("no usable Renown identity"). Default: for `STUDIO_APP_ID` only, fall back to the studio document's `identityDid` when the document is neither tampered nor unverified (Phase 2 already addresses the studio profile this way). Renown still refuses the report unless that DID is a registered workload identity whose owner holds a live delegation.
9. **vetra-cloud-package worktree: Phase 2's.** Phase 3 continues in `/home/f/projects/vetra-cloud-package-profiles` on `feat/identity-hub-profiles` (the worktree the Phase 2 plan creates), because Task 6 edits files Phase 2 creates there. The pre-made `/home/f/projects/vetra-cloud-package-hub` (`feat/identity-hub-stats`) is **not used**; remove it after Phase 3 (`git -C /home/f/projects/vetra-cloud-package worktree remove /home/f/projects/vetra-cloud-package-hub`).
10. **The staging proof reports from inside the environment pod with an inline `fetch`, not with the helper.** (Task 8.) That proves the token and URL reached the environment and the pod can reach Vetra; the helper itself is unit-tested. The proof needs a licensed environment of an app whose identity is registered on **renown-staging** (Phase 2 Task 13's new app); it is set up by hand in Task 15.

## Global Constraints

- Staging first, then prod, for every repo (renown-package, vetra-cloud-package, renown.id, vetra.io). Order per environment: renown-package → vetra-cloud-package → renown.id → vetra.io.
- vetra.io changes land on **both** `staging` and `main`.
- No `Co-Authored-By` / "Generated with" trailers in commits or PRs. Stage explicit paths only (never `git add -A` / `git add .`).
- Never edit `gen/` folders; document-model changes go through the model JSON + `pnpm generate document-model --document <json>` (never `generate all`); reducer code lives in `v1/src/reducers`.
- Reducers pure; new reducer code ≥ 95 % coverage (lines, branches, functions, statements); every new error code has a test; reducer errors are asserted via `operations.global[i].error`, never `.toThrow()`.
- Existing documents stay valid: model changes are additive within v1. Legacy app profiles have no `metrics` key — every reader and reducer treats it as `[]`.
- Secrets never printed or pasted: the reporting token and the registration token are only ever referenced by env-var name; checks print `set`/`MISSING`.
- Metric definition limits: ≤ 16 per app; `key` `^[A-Za-z][A-Za-z0-9_.:-]{0,63}$` (renown-user-stats' metric rule), unique per app; `label` 1–40 (trimmed); `unit` ≤ 16; `description` ≤ 200; `aggregation` ∈ `SUM | MAX | AVG | COUNT_USERS`; `public: Boolean!`.
- Aggregation semantics over current values (one per user): SUM = sum, MAX = max, AVG = mean of users with a value, COUNT_USERS = users with value > 0; `users` = users with a value; `activeUsers30d` = distinct users with any stat for the app reported in the last 30 days; `totalUsers` = distinct users with any stat for the app; top 5 contributors per metric by value desc, ties by earlier `updated_at`, then `user_did`.
- `appStats` is public and returns only declared **public** metrics; undeclared metrics are stored but never exposed by it.
- `upsertAppProfile` patch semantics (Phase 2) plus `metrics`: absent/`null` unchanged, a list replaces the whole set (`[]` clears).
- Reporting contract (unchanged, Vetra side): header `x-vetra-reporting-token`, env vars `VETRA_REPORTING_TOKEN` + `VETRA_LICENSING_URL` (the environment's tenant secret), `mutation { vetraLicensing { reportUserStat(user, metric, value): Boolean! } }`, current-value semantics, `true` = queued (delivered within ~5 s), `false` = not relayed.
- Repos and branches: renown-package `/home/f/projects/renown-package-hub` (`feat/identity-hub`); renown.id `/home/f/projects/renown-hub` (`feat/identity-hub`); vetra.io `/home/f/projects/vetra.io-hub` (`feat/identity-hub`); vetra-cloud-package `/home/f/projects/vetra-cloud-package-profiles` (`feat/identity-hub-profiles`, Ruling 9); hosting `/home/f/projects/powerhouse-k8s-hosting` (`main`, push directly — ArgoCD syncs). Pushes use SSH: `git@github.com:powerhouse-inc/{renown-package,renown,vetra.to,vetra-cloud-package}.git`.
- Checks — renown-package: `pnpm tsc`, `pnpm lint`, `pnpm exec vitest run --coverage`; vetra-cloud-package: `pnpm tsc`, `pnpm lint`, `pnpm exec vitest run subgraphs/vetra-licensing shared`; renown.id: `pnpm exec tsc --noEmit -p .`, `pnpm lint`, `pnpm exec playwright test <spec>`; vetra.io: `pnpm tsc`, `pnpm lint`, `pnpm test:unit`. Pipe long output through `tail -30`; show only failures. Warnings that already exist on the base branch are not yours to fix.

## Review Focus

1. **A legacy app profile** (no `metrics` key — every profile written before this phase) must read back with `metrics: []`, accept `ADD_METRIC` and a `metrics` upsert, and show `appStats` counts — Task 1 "legacy profile" test, Task 4 "legacy profile" test.
2. **Backfill racing live reports:** a backfilled (older) value must never overwrite a newer live one, and a re-run (or a crash mid-way) must neither duplicate nor regress rows — Task 2 "newer or equal wins" test, Task 3 "never overwrites a live value" and "incomplete run" tests.
3. **Private and undeclared metrics stay private:** a metric declared `public: false` or never declared must not appear in `appStats`, and a declared-private one not in `userStats` — Task 5 "public filtering" tests.
4. **Two metrics swapping keys in one save** (`a`↔`b`), or a key change onto a freed key, must save without `DuplicateMetricKeyError` — Task 4 "swaps keys" test.
5. **Falsy-but-valid values** — `0`, negative values, `""` unit — must be stored, counted (COUNT_USERS counts only `> 0`; AVG includes zeros) and cleared correctly — Task 2 aggregation test, Task 1 "clears unit" test, Task 12 form test.

## File structure

renown-package (`/home/f/projects/renown-package-hub`):

| Path | Responsibility |
|---|---|
| `document-models/renown-app-profile/renown-app-profile.json` | model spec: `metrics` state, enum, `metrics` module (codegen input) |
| `document-models/renown-app-profile/v1/src/utils.ts` | metric limits + validators shared by reducers and the write path |
| `document-models/renown-app-profile/v1/src/reducers/metrics.ts` | metric reducers (legacy `metrics` guard) |
| `subgraphs/renown-stats/store/{migrations,types,kysely}.ts` | `app_metric_values`, `renown_stats_jobs`, aggregate queries |
| `subgraphs/renown-stats/core/backfill.ts` | one-time idempotent backfill from user-stats documents |
| `subgraphs/renown-stats/core/app-metrics-patch.ts` | metric input validation and the action diff |
| `subgraphs/renown-stats/core/app-stats.ts` | aggregation → value, windows, top-N constants |
| `subgraphs/renown-stats/lookups.ts` | contributor profiles from the Phase 1 `renown_user` read model |
| `subgraphs/renown-stats/{schema,resolvers,index}.ts`, `README.md` | `metrics` on profiles, aggregates on report, `appStats`, enriched `userStats`, backfill at setup |
| `subgraphs/renown-stats/tests/harness.ts` | shared PGlite + fake reactor harness for the new suites |

vetra-cloud-package (`/home/f/projects/vetra-cloud-package-profiles`):

| Path | Responsibility |
|---|---|
| `subgraphs/vetra-licensing/renown-profile.ts`, `publisher-schema.ts` | relay `metrics` through `updateAppProfile` |
| `subgraphs/vetra-licensing/app-identity.ts`, `index.ts` | the relay's app-identity lookup (studio fallback) |
| `shared/report-user-stat.ts` | the package authors' helper (canonical copy) |
| `scripts/smoke/app-stats-proof.mts` | staging/prod end-to-end proof |
| `docs/superpowers/specs/2026-10-08-licensing-api-contract.md` | contract SDL (parity test) |

renown.id (`/home/f/projects/renown-hub`):

| Path | Responsibility |
|---|---|
| `services/app-stats.ts` | `appStats`/`userStats` reads, grouping for profiles |
| `utils/stat-format.ts` | number formatting, aggregation captions |
| `components/app/app-stats.tsx`, `pages/app/[did].tsx` | stat tiles, active users, top contributors |
| `components/profile/profile-stats.tsx`, `pages/profile/[id].tsx` | "Stats" grouped by app |
| `e2e/support/stub-switchboard.mjs`, `e2e/{stat-format,app-stats,profile-stats}.spec.ts` | stub defaults + specs |

vetra.io (`/home/f/projects/vetra.io-hub`):

| Path | Responsibility |
|---|---|
| `app/docs/app-stats/page.tsx`, `modules/docs/report-user-stat-snippet.ts` | "Report app stats" docs page, helper snippet |
| `modules/apps/lib/app-profile/{metrics,form,api}.ts`, `modules/publisher/types.ts` | metric drafts, validation, patch, reads |
| `modules/apps/components/profile/{metrics-editor,profile-tab}.tsx` | Profile tab "Metrics" section |
| `modules/apps/lib/app-stats/{api,format}.ts`, `modules/apps/hooks/use-app-stats.ts`, `modules/apps/components/stats/app-stats-card.tsx`, `modules/apps/components/app-overview.tsx` | overview stat tiles |

---

## Part A — renown-package

Precondition: Phase 2 Tasks 1–4 are committed on `feat/identity-hub`. `cd /home/f/projects/renown-package-hub && git switch feat/identity-hub && git pull --ff-only 2>/dev/null; git log --oneline -1`.

### Task 1: `renown-app-profile` metric definitions (model + reducers)

**Files:**
- Modify: `document-models/renown-app-profile/renown-app-profile.json` (state schema, initial value, new module `metrics` with 4 operations)
- Regenerate: `document-models/renown-app-profile/v1/gen/**`, `v1/schema.graphql` (codegen only)
- Modify: `document-models/renown-app-profile/v1/src/utils.ts` (append), `document-models/renown-app-profile/v1/tests/profile.test.ts` (one expectation)
- Replace: `document-models/renown-app-profile/v1/src/reducers/metrics.ts` (codegen creates the stub)
- Test: `document-models/renown-app-profile/v1/tests/metrics.test.ts`

**Interfaces:**
- Consumes: Phase 2 Task 1 model (state with `links`, `isValidLinkLabel` etc.).
- Produces (re-exported from `document-models/renown-app-profile/index.js` and `document-models/renown-app-profile/v1`):
  - state adds `metrics: RenownAppMetric[]`; `RenownAppMetric { id: string; key: string; label: string; unit?: string | null; description?: string | null; aggregation: RenownMetricAggregation; public: boolean }`; `type RenownMetricAggregation = "AVG" | "COUNT_USERS" | "MAX" | "SUM"` (codegen string union).
  - action creators (also on `actions.*`): `addMetric({ id, key, label, unit?, description?, aggregation, public })`, `updateMetric({ id, key?, label?, unit?, description?, aggregation?, public? })` (`null`/absent unchanged, `""` unit/description clears), `removeMetric({ id })`, `reorderMetrics({ metricIds })`.
  - utils: `MAX_METRICS = 16`, `MAX_METRIC_LABEL_LENGTH = 40`, `MAX_METRIC_UNIT_LENGTH = 16`, `MAX_METRIC_DESCRIPTION_LENGTH = 200`, `METRIC_AGGREGATIONS = ["SUM", "MAX", "AVG", "COUNT_USERS"] as const`, `isMetricKey(s): boolean`, `metricProblem({ key, label, unit?, description? }): string | null`.
  - errors (`v1/gen/metrics/error.ts`): `TooManyMetricsError`, `DuplicateMetricIdError`, `DuplicateMetricKeyError`, `InvalidMetricError`, `MetricNotFoundError`.
  - reducer object `renownAppProfileMetricsOperations` (`v1/src/reducers/metrics.ts`).

- [ ] **Step 1: Extend the model spec and generate.** From the repo root:

```bash
python3 - <<'PLAN_EOF'
import json
p = "document-models/renown-app-profile/renown-app-profile.json"
d = json.load(open(p))
spec = d["specifications"][0]
schema = spec["state"]["global"]["schema"]
assert "metrics:" not in schema, "metrics already present"
anchor = "  links: [RenownAppLink!]!\n}"
assert anchor in schema, "Phase 2 state schema not found"
schema = schema.replace(
    anchor,
    "  links: [RenownAppLink!]!\n"
    "  \"Publisher-defined metrics, at most 16, in display order\"\n"
    "  metrics: [RenownAppMetric!]!\n"
    "}",
    1,
)
schema += (
    "\n\nenum RenownMetricAggregation {\n"
    "  SUM\n"
    "  MAX\n"
    "  AVG\n"
    "  COUNT_USERS\n"
    "}\n\n"
    "type RenownAppMetric {\n"
    "  id: OID!\n"
    "  \"The metric name the app reports: ^[A-Za-z][A-Za-z0-9_.:-]{0,63}$\"\n"
    "  key: String!\n"
    "  \"1-40 characters\"\n"
    "  label: String!\n"
    "  \"At most 16 characters, e.g. notes\"\n"
    "  unit: String\n"
    "  \"At most 200 characters\"\n"
    "  description: String\n"
    "  aggregation: RenownMetricAggregation!\n"
    "  \"Shown on the app page and on user profiles\"\n"
    "  public: Boolean!\n"
    "}"
)
spec["state"]["global"]["schema"] = schema
initial = json.loads(spec["state"]["global"]["initialValue"])
initial["metrics"] = []
spec["state"]["global"]["initialValue"] = json.dumps(initial, indent=2)

def err(eid, name, code, desc):
    return {"id": eid, "name": name, "code": code, "description": desc, "template": ""}

def op(oid, name, desc, schema, errors):
    return {"id": oid, "name": name, "description": desc, "schema": schema, "template": "",
            "reducer": "", "errors": errors, "examples": [], "scope": "global"}

assert all(m["name"] != "metrics" for m in spec["modules"]), "metrics module already present"
spec["modules"].append({
    "id": "renown-app-profile-metrics",
    "name": "metrics",
    "description": "Publisher-defined metrics: what the app reports and how Renown aggregates and shows it",
    "operations": [
        op("add-app-metric", "ADD_METRIC", "Declares a metric at the end of the list",
           "input AddMetricInput {\n  id: OID!\n  \"^[A-Za-z][A-Za-z0-9_.:-]{0,63}$, unique per app\"\n  key: String!\n"
           "  \"1-40 characters after trimming\"\n  label: String!\n  \"At most 16 characters; empty means none\"\n  unit: String\n"
           "  \"At most 200 characters; empty means none\"\n  description: String\n"
           "  aggregation: RenownMetricAggregation!\n  public: Boolean!\n}",
           [err("too-many-metrics-error", "TooManyMetricsError", "TOO_MANY_METRICS", "The profile already declares 16 metrics"),
            err("duplicate-metric-id-error", "DuplicateMetricIdError", "DUPLICATE_METRIC_ID", "A metric with this id already exists"),
            err("duplicate-metric-key-error", "DuplicateMetricKeyError", "DUPLICATE_METRIC_KEY", "Another metric already uses this key"),
            err("invalid-metric-error", "InvalidMetricError", "INVALID_METRIC",
                "The key does not match the metric rule, or the label, unit or description is out of bounds")]),
        op("update-app-metric", "UPDATE_METRIC", "Changes fields of a metric; absent fields are unchanged, an empty unit or description clears it",
           "input UpdateMetricInput {\n  id: OID!\n  key: String\n  label: String\n  unit: String\n  description: String\n"
           "  aggregation: RenownMetricAggregation\n  public: Boolean\n}",
           [err("metric-not-found-error", "MetricNotFoundError", "METRIC_NOT_FOUND", "No metric with this id exists")]),
        op("remove-app-metric", "REMOVE_METRIC", "Removes a metric definition (reported values are kept)",
           "input RemoveMetricInput {\n  id: OID!\n}", []),
        op("reorder-app-metrics", "REORDER_METRICS",
           "Moves the listed metrics to the front in the given order; unlisted metrics keep their relative order after them",
           "input ReorderMetricsInput {\n  metricIds: [OID!]!\n}", []),
    ],
})
json.dump(d, open(p, "w"), indent=2)
open(p, "a").write("\n")
PLAN_EOF
pnpm generate document-model --document document-models/renown-app-profile/renown-app-profile.json 2>&1 | tail -5
git checkout -- document-models/renown-app-profile/v1/tests/profile.test.ts document-models/renown-app-profile/v1/tests/rich-profile.test.ts powerhouse.manifest.json 2>/dev/null || true
git status --short
```

Expected: `renown-app-profile.json`, `v1/gen/**` (new `v1/gen/metrics/`), `v1/schema.graphql` changed, and a new `v1/src/reducers/metrics.ts` stub (four methods throwing "not implemented"). If the generator touched anything else, restore it with `git checkout --`.

- [ ] **Step 2: Write the failing tests.**

Create `document-models/renown-app-profile/v1/tests/metrics.test.ts` with exactly:

```ts
import { describe, expect, it } from "vitest";
import {
  addMetric,
  isMetricKey,
  MAX_METRICS,
  metricProblem,
  reducer,
  removeMetric,
  reorderMetrics,
  setAppDid,
  updateMetric,
  utils,
} from "document-models/renown-app-profile/v1";

const APP = "did:key:zDnaerDaTF5BXEavCrfRZEk316dpbLsfPDZ3WJ5hRTPFU2169";
const NOTES = {
  id: "m-notes",
  key: "notes",
  label: "Notes",
  unit: "notes",
  description: "Notes written",
  aggregation: "SUM" as const,
  public: true,
};
const STREAK = {
  id: "m-streak",
  key: "streak.days",
  label: "Longest streak",
  unit: null,
  description: null,
  aggregation: "MAX" as const,
  public: false,
};
const SCORE = { id: "m-score", key: "score", label: "Score", aggregation: "AVG" as const, public: true };

type Doc = ReturnType<typeof utils.createDocument>;

/** Each global operation's error message (undefined when it applied). */
function errors(doc: Doc): (string | undefined)[] {
  return doc.operations.global.map((op) => op.error);
}

function withApp(): Doc {
  return reducer(utils.createDocument(), setAppDid({ appDid: APP }));
}

describe("RenownAppProfile metrics", () => {
  it("starts with no metrics", () => {
    expect(utils.createDocument().state.global.metrics).toEqual([]);
  });

  it("declares, edits, reorders and removes metrics", () => {
    let d = withApp();
    d = reducer(d, addMetric({ ...NOTES, label: "  Notes ", unit: " notes " }));
    d = reducer(d, addMetric(STREAK));
    d = reducer(d, addMetric({ ...SCORE, unit: "", description: "   " }));
    d = reducer(d, updateMetric({ id: "m-streak", label: "Best streak", public: true }));
    d = reducer(d, updateMetric({ id: "m-score", key: "score.avg", aggregation: "COUNT_USERS", unit: "pts" }));
    d = reducer(d, updateMetric({ id: "m-notes" }));
    d = reducer(d, reorderMetrics({ metricIds: ["m-score", "m-streak", "m-score"] }));
    d = reducer(d, removeMetric({ id: "m-streak" }));
    expect(errors(d)).toEqual(Array(9).fill(undefined));
    expect(d.state.global.metrics).toEqual([
      {
        id: "m-score",
        key: "score.avg",
        label: "Score",
        unit: "pts",
        description: null,
        aggregation: "COUNT_USERS",
        public: true,
      },
      { ...NOTES },
    ]);
  });

  it("clears a unit or description with an empty string and keeps a falsy public flag", () => {
    let d = withApp();
    d = reducer(d, addMetric(NOTES));
    d = reducer(d, updateMetric({ id: "m-notes", unit: "", description: " ", public: false }));
    expect(errors(d)[2]).toBeUndefined();
    expect(d.state.global.metrics[0]).toMatchObject({ unit: null, description: null, public: false });
  });

  it("enforces the limits, unique ids and unique keys", () => {
    let d = withApp();
    for (let i = 0; i < MAX_METRICS; i++) {
      d = reducer(d, addMetric({ ...SCORE, id: `m${i}`, key: `k${i}` }));
    }
    d = reducer(d, addMetric({ ...SCORE, id: "m-extra", key: "extra" }));
    expect(errors(d)[MAX_METRICS + 1]).toMatch(/at most 16/);

    d = reducer(withApp(), addMetric(NOTES));
    d = reducer(d, addMetric({ ...NOTES, key: "other" }));
    d = reducer(d, addMetric({ ...NOTES, id: "m-2" }));
    d = reducer(d, addMetric({ ...STREAK }));
    d = reducer(d, updateMetric({ id: "m-streak", key: "notes" }));
    const e = errors(d);
    expect(e[2]).toMatch(/id m-notes is already used/);
    expect(e[3]).toMatch(/key notes is already declared/);
    expect(e[4]).toBeUndefined();
    expect(e[5]).toMatch(/key notes is already declared/);
    expect(d.state.global.metrics.map((m) => m.key)).toEqual(["notes", "streak.days"]);
  });

  it("rejects invalid fields on add and update without changing anything", () => {
    let d = withApp();
    d = reducer(d, addMetric({ ...NOTES, key: "1notes" }));
    d = reducer(d, addMetric({ ...NOTES, key: "has space" }));
    d = reducer(d, addMetric({ ...NOTES, label: "   " }));
    d = reducer(d, addMetric({ ...NOTES, label: "l".repeat(41) }));
    d = reducer(d, addMetric({ ...NOTES, unit: "u".repeat(17) }));
    d = reducer(d, addMetric({ ...NOTES, description: "d".repeat(201) }));
    d = reducer(d, addMetric({ ...NOTES, label: "l".repeat(40), unit: "u".repeat(16), description: "d".repeat(200) }));
    d = reducer(d, updateMetric({ id: "m-notes", key: "k".repeat(65) }));
    d = reducer(d, updateMetric({ id: "m-notes", label: "" }));
    const e = errors(d);
    expect(e[1]).toMatch(/key/);
    expect(e[2]).toMatch(/key/);
    expect(e[3]).toMatch(/label/);
    expect(e[4]).toMatch(/label/);
    expect(e[5]).toMatch(/unit/);
    expect(e[6]).toMatch(/description/);
    expect(e[7]).toBeUndefined();
    expect(e[8]).toMatch(/key/);
    expect(e[9]).toMatch(/label/);
    expect(d.state.global.metrics).toHaveLength(1);
    expect(d.state.global.metrics[0]?.key).toBe("notes");
  });

  it("reports unknown metric ids", () => {
    let d = withApp();
    d = reducer(d, updateMetric({ id: "missing", label: "x" }));
    d = reducer(d, removeMetric({ id: "missing" }));
    d = reducer(d, reorderMetrics({ metricIds: ["missing"] }));
    expect(errors(d).slice(1).every((m) => /No metric with id missing/.test(m ?? ""))).toBe(true);
  });

  it("treats a legacy profile without a metrics key as empty", () => {
    const legacy = () => {
      const doc = withApp();
      delete (doc.state.global as Record<string, unknown>).metrics;
      return doc;
    };
    expect(reducer(legacy(), addMetric(NOTES)).state.global.metrics).toEqual([NOTES]);
    expect(reducer(legacy(), removeMetric({ id: "x" })).operations.global[1]?.error).toMatch(/No metric/);
    expect(reducer(legacy(), updateMetric({ id: "x" })).operations.global[1]?.error).toMatch(/No metric/);
    expect(reducer(legacy(), reorderMetrics({ metricIds: [] })).state.global.metrics).toEqual([]);
  });

  it("validates keys and fields the same way for the write path", () => {
    expect(isMetricKey("a")).toBe(true);
    expect(isMetricKey(`a${"b".repeat(63)}`)).toBe(true);
    expect(isMetricKey(`a${"b".repeat(64)}`)).toBe(false);
    expect(isMetricKey("notes:v2.total-x_y")).toBe(true);
    expect(metricProblem({ key: "notes", label: "Notes", unit: null, description: null })).toBeNull();
    expect(metricProblem({ key: "notes", label: "Notes" })).toBeNull();
  });
});
```

In `document-models/renown-app-profile/v1/tests/profile.test.ts` (the expectation Phase 2 Task 1 extended) replace:

```ts
      coverRef: null,
      links: [],
    });
```

with:

```ts
      coverRef: null,
      links: [],
      metrics: [],
    });
```

- [ ] **Step 3: Run them to see them fail.** `pnpm exec vitest run document-models/renown-app-profile 2>&1 | tail -20` → FAIL: `isMetricKey`/`MAX_METRICS` not exported; metric operations report `Reducer for 'addMetricOperation' not implemented.`

- [ ] **Step 4: Implement utils and reducers.**

Append to `document-models/renown-app-profile/v1/src/utils.ts`:

```ts

/** Most metrics one app may declare. */
export const MAX_METRICS = 16;
export const MAX_METRIC_LABEL_LENGTH = 40;
export const MAX_METRIC_UNIT_LENGTH = 16;
export const MAX_METRIC_DESCRIPTION_LENGTH = 200;
export const METRIC_AGGREGATIONS = ["SUM", "MAX", "AVG", "COUNT_USERS"] as const;

/** renown-user-stats' metric rule: what an app may report. */
const METRIC_KEY = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;

export function isMetricKey(value: string): boolean {
  return METRIC_KEY.test(value);
}

/**
 * Why a metric definition is invalid, or null. Expects trimmed label, unit
 * and description; a null/absent unit or description means none.
 */
export function metricProblem(metric: {
  key: string;
  label: string;
  unit?: string | null;
  description?: string | null;
}): string | null {
  if (!isMetricKey(metric.key)) {
    return "Metric key must match ^[A-Za-z][A-Za-z0-9_.:-]{0,63}$";
  }
  if (metric.label.length === 0 || metric.label.length > MAX_METRIC_LABEL_LENGTH) {
    return `Metric label must be 1-${MAX_METRIC_LABEL_LENGTH} characters`;
  }
  if (metric.unit != null && metric.unit.length > MAX_METRIC_UNIT_LENGTH) {
    return `Metric unit must be at most ${MAX_METRIC_UNIT_LENGTH} characters`;
  }
  if (
    metric.description != null &&
    metric.description.length > MAX_METRIC_DESCRIPTION_LENGTH
  ) {
    return `Metric description must be at most ${MAX_METRIC_DESCRIPTION_LENGTH} characters`;
  }
  return null;
}
```

Replace the whole of `document-models/renown-app-profile/v1/src/reducers/metrics.ts` with exactly:

```ts
import type {
  RenownAppMetric,
  RenownAppProfileMetricsOperations,
  RenownAppProfileState,
} from "document-models/renown-app-profile/v1";
import {
  DuplicateMetricIdError,
  DuplicateMetricKeyError,
  InvalidMetricError,
  MetricNotFoundError,
  TooManyMetricsError,
} from "../../gen/metrics/error.js";
import { MAX_METRICS, metricProblem } from "../utils.js";

/** Trimmed; empty (or whitespace only) means none. */
function optionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/**
 * The profile's metrics. Profiles created before metrics existed carry no
 * `metrics` key at all; they are treated as empty and the list is created on
 * first write.
 */
function metricsOf(state: RenownAppProfileState): RenownAppMetric[] {
  const legacy = state as { metrics?: RenownAppMetric[] };
  legacy.metrics ??= [];
  return legacy.metrics;
}

function findMetric(metrics: RenownAppMetric[], id: string): RenownAppMetric {
  const metric = metrics.find((m) => m.id === id);
  if (!metric) throw new MetricNotFoundError(`No metric with id ${id}`);
  return metric;
}

/** InvalidMetricError or DuplicateMetricKeyError unless `metric` may join `metrics`. */
function assertAcceptable(metrics: RenownAppMetric[], metric: RenownAppMetric): void {
  const problem = metricProblem(metric);
  if (problem) throw new InvalidMetricError(problem);
  if (metrics.some((m) => m.key === metric.key && m.id !== metric.id)) {
    throw new DuplicateMetricKeyError(`Metric key ${metric.key} is already declared`);
  }
}

export const renownAppProfileMetricsOperations: RenownAppProfileMetricsOperations =
  {
    addMetricOperation(state, action) {
      const input = action.input;
      const metrics = metricsOf(state);
      if (metrics.some((m) => m.id === input.id)) {
        throw new DuplicateMetricIdError(`Metric id ${input.id} is already used`);
      }
      if (metrics.length >= MAX_METRICS) {
        throw new TooManyMetricsError(
          `A profile declares at most ${MAX_METRICS} metrics`,
        );
      }
      const metric: RenownAppMetric = {
        id: input.id,
        key: input.key,
        label: input.label.trim(),
        unit: optionalText(input.unit),
        description: optionalText(input.description),
        aggregation: input.aggregation,
        public: input.public,
      };
      assertAcceptable(metrics, metric);
      metrics.push(metric);
    },
    updateMetricOperation(state, action) {
      const input = action.input;
      const metrics = metricsOf(state);
      const current = findMetric(metrics, input.id);
      const next: RenownAppMetric = {
        id: current.id,
        key: input.key ?? current.key,
        label: input.label != null ? input.label.trim() : current.label,
        unit: input.unit != null ? optionalText(input.unit) : current.unit,
        description:
          input.description != null
            ? optionalText(input.description)
            : current.description,
        aggregation: input.aggregation ?? current.aggregation,
        public: input.public ?? current.public,
      };
      assertAcceptable(metrics, next);
      Object.assign(current, next);
    },
    removeMetricOperation(state, action) {
      const metrics = metricsOf(state);
      const index = metrics.findIndex((m) => m.id === action.input.id);
      if (index === -1) {
        throw new MetricNotFoundError(`No metric with id ${action.input.id}`);
      }
      metrics.splice(index, 1);
    },
    reorderMetricsOperation(state, action) {
      const metrics = metricsOf(state);
      const front: RenownAppMetric[] = [];
      for (const id of action.input.metricIds) {
        const metric = findMetric(metrics, id);
        if (!front.includes(metric)) front.push(metric);
      }
      state.metrics = [...front, ...metrics.filter((m) => !front.includes(m))];
    },
  };
```

- [ ] **Step 5: Run tests, coverage, types, lint.** `pnpm exec vitest run document-models/renown-app-profile 2>&1 | tail -15` → PASS (all three test files). `pnpm exec vitest run --coverage 2>&1 | grep -E "metrics.ts|ERROR|Threshold"` → `reducers/metrics.ts` 100 % in every column, thresholds pass. `pnpm tsc 2>&1 | tail -5`, `pnpm lint 2>&1 | tail -5` → no errors.

- [ ] **Step 6: Commit.**

```bash
git add document-models/renown-app-profile/renown-app-profile.json document-models/renown-app-profile/v1/gen document-models/renown-app-profile/v1/schema.graphql document-models/renown-app-profile/v1/src/utils.ts document-models/renown-app-profile/v1/src/reducers/metrics.ts document-models/renown-app-profile/v1/tests/profile.test.ts document-models/renown-app-profile/v1/tests/metrics.test.ts
git commit -m "feat(renown-app-profile): publisher-defined metric definitions"
```

### Task 2: renown-stats store — per-user metric values, aggregates, jobs

**Files:**
- Modify: `subgraphs/renown-stats/store/migrations.ts`, `subgraphs/renown-stats/store/types.ts`, `subgraphs/renown-stats/store/kysely.ts`
- Test: `subgraphs/renown-stats/tests/store-metrics.test.ts`

**Interfaces:**
- Consumes: Phase 2 Task 2 `KyselyStatsIndex`, `StatsDB`, `StatsIndex`.
- Produces (`subgraphs/renown-stats/store/types.ts`):
  - tables `app_metric_values(app_did text, metric text, user_did text, value double precision, updated_at timestamptz, pk(app_did, metric, user_did))` + index `(app_did, updated_at)`; `renown_stats_jobs(name text pk, completed_at timestamptz)`.
  - `interface MetricValue { appDid: string; metric: string; userDid: string; value: number; updatedAt: Date }`.
  - `interface MetricAggregate { metric: string; users: number; sum: number; max: number; avg: number; positiveUsers: number; top: { userDid: string; value: number }[] }`.
  - `interface AppActivity { totalUsers: number; activeUsers: number; updatedAt: Date | null }`; `interface UserStatsDocumentEntry { userDid: string; documentId: string }`.
  - `StatsIndex.recordMetricValues(values: readonly MetricValue[]): Promise<void>` (per key the newest `updatedAt` wins; an equal one overwrites; an older one is ignored).
  - `StatsIndex.metricAggregates(appDid: string, metrics: readonly string[], top: number): Promise<MetricAggregate[]>` (only metrics with at least one value; top ordered by value desc, `updated_at` asc, `user_did` asc).
  - `StatsIndex.appActivity(appDid: string, since: Date): Promise<AppActivity>`.
  - `StatsIndex.userStatsDocumentsPage(limit: number, afterUserDid?: string): Promise<UserStatsDocumentEntry[]>` (ordered by `user_did`).
  - `StatsIndex.jobDone(name: string): Promise<boolean>`, `StatsIndex.markJobDone(name: string, at: Date): Promise<void>`.

- [ ] **Step 1: Write the failing test.**

Create `subgraphs/renown-stats/tests/store-metrics.test.ts` with exactly:

```ts
import { PGlite } from "@electric-sql/pglite";
import { Kysely, sql } from "kysely";
import { PGliteDialect } from "kysely-pglite-dialect";
import { afterAll, describe, expect, it } from "vitest";
import { KyselyStatsIndex } from "../store/kysely.js";
import { migrate } from "../store/migrations.js";
import type { MetricValue, StatsDB } from "../store/types.js";

const opened: Kysely<StatsDB>[] = [];
afterAll(async () => {
  await Promise.all(opened.map((db) => db.destroy()));
});

async function makeIndex(): Promise<KyselyStatsIndex> {
  const root = new Kysely<StatsDB>({ dialect: new PGliteDialect(new PGlite()) });
  opened.push(root);
  await sql`create schema "renown-stats"`.execute(root);
  const db = root.withSchema("renown-stats");
  await migrate(db);
  await migrate(db); // idempotent
  return new KyselyStatsIndex(db);
}

const APP = "did:key:zApp1";
const OTHER_APP = "did:key:zApp2";
const T0 = new Date("2026-09-01T00:00:00Z");
const T1 = new Date("2026-10-01T00:00:00Z");
const T2 = new Date("2026-10-08T00:00:00Z");
const value = (userDid: string, metric: string, v: number, at = T1, appDid = APP): MetricValue => ({
  appDid,
  metric,
  userDid,
  value: v,
  updatedAt: at,
});

describe("KyselyStatsIndex metric values", () => {
  it("aggregates current values per metric: sum, max, avg, users above zero and the top contributors", async () => {
    const index = await makeIndex();
    await index.recordMetricValues([
      value("u1", "notes", 10, T1),
      value("u2", "notes", 0, T1),
      value("u3", "notes", -2, T1),
      value("u4", "notes", 5, T0),
      value("u5", "notes", 5, T1),
      value("u1", "streak", 3),
      value("u9", "notes", 1000, T1, OTHER_APP),
    ]);
    const [notes, streak] = await index.metricAggregates(APP, ["notes", "streak", "never"], 2);
    expect(notes).toEqual({
      metric: "notes",
      users: 5,
      sum: 18,
      max: 10,
      avg: 3.6,
      positiveUsers: 3,
      // Ties at 5: the earlier report first.
      top: [
        { userDid: "u1", value: 10 },
        { userDid: "u4", value: 5 },
      ],
    });
    expect(streak).toMatchObject({ metric: "streak", users: 1, sum: 3, max: 3, avg: 3, positiveUsers: 1 });
    expect(await index.metricAggregates(APP, [], 5)).toEqual([]);
    expect((await index.metricAggregates(APP, ["notes"], 0))[0]?.top).toEqual([]);
  });

  it("keeps the newest value per (app, metric, user): newer or equal wins, older is ignored", async () => {
    const index = await makeIndex();
    await index.recordMetricValues([value("u1", "m", 5, T2)]);
    await index.recordMetricValues([value("u1", "m", 3, T1)]);
    expect((await index.metricAggregates(APP, ["m"], 1))[0]?.sum).toBe(5);
    await index.recordMetricValues([value("u1", "m", 7, T2)]);
    expect((await index.metricAggregates(APP, ["m"], 1))[0]?.sum).toBe(7);
    // One batch carrying the same key twice keeps the newest.
    await index.recordMetricValues([value("u2", "m", 1, T0), value("u2", "m", 9, T2), value("u2", "m", 4, T1)]);
    expect((await index.metricAggregates(APP, ["m"], 5))[0]?.top).toEqual([
      { userDid: "u2", value: 9 },
      { userDid: "u1", value: 7 },
    ]);
    await index.recordMetricValues([]);
  });

  it("stays consistent under concurrent upserts", async () => {
    const index = await makeIndex();
    const users = Array.from({ length: 20 }, (_, i) => `user-${i}`);
    const stamps = Array.from({ length: 10 }, (_, i) => new Date(T1.getTime() + i * 1000));
    await Promise.all([
      ...users.map((u, i) => index.recordMetricValues([value(u, "m", i + 1)])),
      // Ten reports of one key arriving out of order: the newest stamp wins.
      ...[7, 2, 9, 0, 4, 1, 8, 3, 6, 5].map((i) => index.recordMetricValues([value("hot", "m", 100 + i, stamps[i])])),
    ]);
    const [m] = await index.metricAggregates(APP, ["m"], 1);
    expect(m?.users).toBe(21);
    expect(m?.top).toEqual([{ userDid: "hot", value: 109 }]);
  });

  it("counts total and recently active users of an app, and when it last heard", async () => {
    const index = await makeIndex();
    expect(await index.appActivity(APP, T1)).toEqual({ totalUsers: 0, activeUsers: 0, updatedAt: null });
    await index.recordMetricValues([
      value("u1", "a", 1, T0),
      value("u1", "b", 1, T2),
      value("u2", "a", 1, T0),
      value("u3", "a", 0, T1),
      value("u4", "a", 1, T2, OTHER_APP),
    ]);
    expect(await index.appActivity(APP, T1)).toEqual({ totalUsers: 3, activeUsers: 2, updatedAt: T2 });
  });

  it("pages through user-stats documents by user DID", async () => {
    const index = await makeIndex();
    for (const did of ["did:c", "did:a", "did:b"]) await index.claimUserStatsDocument(did, `doc-${did}`, T1);
    const first = await index.userStatsDocumentsPage(2);
    expect(first).toEqual([
      { userDid: "did:a", documentId: "doc-did:a" },
      { userDid: "did:b", documentId: "doc-did:b" },
    ]);
    expect(await index.userStatsDocumentsPage(2, "did:b")).toEqual([{ userDid: "did:c", documentId: "doc-did:c" }]);
  });

  it("records one-time jobs idempotently", async () => {
    const index = await makeIndex();
    expect(await index.jobDone("job")).toBe(false);
    await index.markJobDone("job", T1);
    await index.markJobDone("job", T2);
    expect(await index.jobDone("job")).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to see it fail.** `pnpm exec vitest run subgraphs/renown-stats/tests/store-metrics.test.ts 2>&1 | tail -15` → FAIL (`index.recordMetricValues is not a function`).

- [ ] **Step 3: Implement.**

In `subgraphs/renown-stats/store/migrations.ts` replace the end of `migrate` (Phase 2 text):

```ts
    .columns(["created_at", "app_did"])
    .execute();
}
```

with:

```ts
    .columns(["created_at", "app_did"])
    .execute();

  // Phase 3: the current value of every (app, metric, user), for app-level
  // aggregates, and one-time jobs (the backfill of those values).
  await db.schema
    .createTable("app_metric_values")
    .ifNotExists()
    .addColumn("app_did", "text", (col) => col.notNull())
    .addColumn("metric", "text", (col) => col.notNull())
    .addColumn("user_did", "text", (col) => col.notNull())
    .addColumn("value", "double precision", (col) => col.notNull())
    .addColumn("updated_at", "timestamptz", (col) => col.notNull())
    .addPrimaryKeyConstraint("app_metric_values_pk", ["app_did", "metric", "user_did"])
    .execute();
  await db.schema
    .createIndex("app_metric_values_app_updated")
    .ifNotExists()
    .on("app_metric_values")
    .columns(["app_did", "updated_at"])
    .execute();
  await db.schema
    .createTable("renown_stats_jobs")
    .ifNotExists()
    .addColumn("name", "text", (col) => col.primaryKey())
    .addColumn("completed_at", "timestamptz", (col) => col.notNull())
    .execute();
}
```

In `subgraphs/renown-stats/store/types.ts` replace (Phase 2 text):

```ts
export interface StatsDB {
  user_stats_documents: UserStatsDocumentRow;
  app_profile_documents: AppProfileDocumentRow;
  app_profile_images: AppProfileImagesRow;
}
```

with:

```ts
/** One user's current value of one app metric (last accepted report). */
export interface AppMetricValueRow {
  app_did: string;
  metric: string;
  user_did: string;
  value: number;
  updated_at: Timestamp;
}

/** One-time jobs that have completed (e.g. the metric backfill). */
export interface StatsJobRow {
  name: string;
  completed_at: Timestamp;
}

export interface StatsDB {
  user_stats_documents: UserStatsDocumentRow;
  app_profile_documents: AppProfileDocumentRow;
  app_profile_images: AppProfileImagesRow;
  app_metric_values: AppMetricValueRow;
  renown_stats_jobs: StatsJobRow;
}

export interface MetricValue {
  appDid: string;
  metric: string;
  userDid: string;
  value: number;
  /** When the report was accepted (backfill: the document's updatedAt). */
  updatedAt: Date;
}

/** Raw aggregates of one metric over every user's current value. */
export interface MetricAggregate {
  metric: string;
  /** Users with a value. */
  users: number;
  sum: number;
  max: number;
  avg: number;
  /** Users whose value is above zero. */
  positiveUsers: number;
  /** Highest values first; ties: earlier report, then user DID. */
  top: { userDid: string; value: number }[];
}

export interface AppActivity {
  /** Users with any stat for the app. */
  totalUsers: number;
  /** Users with any stat for the app reported since the given time. */
  activeUsers: number;
  /** The latest report for the app, or null. */
  updatedAt: Date | null;
}

export interface UserStatsDocumentEntry {
  userDid: string;
  documentId: string;
}
```

and replace (Phase 2 text):

```ts
  /** Up to `limit` profiles, newest first, strictly after `after`. */
  appProfilesPage(limit: number, after?: AppProfileCursor): Promise<AppProfileListEntry[]>;
}
```

with:

```ts
  /** Up to `limit` profiles, newest first, strictly after `after`. */
  appProfilesPage(limit: number, after?: AppProfileCursor): Promise<AppProfileListEntry[]>;
  /** Upserts current values; per key the newest updatedAt wins (equal overwrites, older is ignored). */
  recordMetricValues(values: readonly MetricValue[]): Promise<void>;
  /** Aggregates of the given metrics of an app that have at least one value. */
  metricAggregates(appDid: string, metrics: readonly string[], top: number): Promise<MetricAggregate[]>;
  appActivity(appDid: string, since: Date): Promise<AppActivity>;
  /** Up to `limit` user-stats documents ordered by user DID, strictly after `afterUserDid`. */
  userStatsDocumentsPage(limit: number, afterUserDid?: string): Promise<UserStatsDocumentEntry[]>;
  jobDone(name: string): Promise<boolean>;
  markJobDone(name: string, at: Date): Promise<void>;
}
```

In `subgraphs/renown-stats/store/kysely.ts` replace the import block (Phase 2 text):

```ts
import type {
  AppImageField,
  AppImagesPatch,
  AppProfileCursor,
  AppProfileEntry,
  AppProfileListEntry,
  StatsIndex,
  StatsKysely,
} from "./types.js";
```

with:

```ts
import { sql } from "kysely";
import type {
  AppActivity,
  AppImageField,
  AppImagesPatch,
  AppProfileCursor,
  AppProfileEntry,
  AppProfileListEntry,
  MetricAggregate,
  MetricValue,
  StatsIndex,
  StatsKysely,
  UserStatsDocumentEntry,
} from "./types.js";

const keyOf = (v: MetricValue) => `${v.appDid}\u0000${v.metric}\u0000${v.userDid}`;
```

and replace the end of the class (the end of Phase 2's `appProfilesPage`):

```ts
      createdAt: new Date(row.created_at),
    }));
  }
}
```

with:

```ts
      createdAt: new Date(row.created_at),
    }));
  }

  async recordMetricValues(values: readonly MetricValue[]): Promise<void> {
    // One statement cannot touch a row twice: keep the newest per key.
    const newest = new Map<string, MetricValue>();
    for (const v of values) {
      const seen = newest.get(keyOf(v));
      if (!seen || seen.updatedAt.getTime() <= v.updatedAt.getTime()) newest.set(keyOf(v), v);
    }
    if (newest.size === 0) return;
    await this.db
      .insertInto("app_metric_values")
      .values(
        [...newest.values()].map((v) => ({
          app_did: v.appDid,
          metric: v.metric,
          user_did: v.userDid,
          value: v.value,
          updated_at: v.updatedAt,
        })),
      )
      .onConflict((oc) =>
        oc
          .columns(["app_did", "metric", "user_did"])
          .doUpdateSet((eb) => ({
            value: eb.ref("excluded.value"),
            updated_at: eb.ref("excluded.updated_at"),
          }))
          .where(sql<boolean>`app_metric_values.updated_at <= excluded.updated_at`),
      )
      .execute();
  }

  async metricAggregates(appDid: string, metrics: readonly string[], top: number): Promise<MetricAggregate[]> {
    if (metrics.length === 0) return [];
    const totals = await this.db
      .selectFrom("app_metric_values")
      .select([
        "metric",
        sql<number>`count(*)::int`.as("users"),
        sql<number>`coalesce(sum(value), 0)::float8`.as("sum"),
        sql<number>`coalesce(max(value), 0)::float8`.as("max"),
        sql<number>`coalesce(avg(value), 0)::float8`.as("avg"),
        sql<number>`(count(*) filter (where value > 0))::int`.as("positive"),
      ])
      .where("app_did", "=", appDid)
      .where("metric", "in", [...metrics])
      .groupBy("metric")
      .orderBy("metric")
      .execute();
    const ranked = this.db
      .selectFrom("app_metric_values")
      .select([
        "metric",
        "user_did",
        "value",
        sql<number>`row_number() over (partition by metric order by value desc, updated_at asc, user_did asc)`.as(
          "place",
        ),
      ])
      .where("app_did", "=", appDid)
      .where("metric", "in", [...metrics]);
    const leaders =
      top > 0
        ? await this.db
            .selectFrom(ranked.as("ranked"))
            .select(["metric", "user_did", "value"])
            .where("place", "<=", top)
            .orderBy("metric")
            .orderBy("place")
            .execute()
        : [];
    return totals.map((row) => ({
      metric: row.metric,
      users: Number(row.users),
      sum: Number(row.sum),
      max: Number(row.max),
      avg: Number(row.avg),
      positiveUsers: Number(row.positive),
      top: leaders
        .filter((leader) => leader.metric === row.metric)
        .map((leader) => ({ userDid: leader.user_did, value: Number(leader.value) })),
    }));
  }

  async appActivity(appDid: string, since: Date): Promise<AppActivity> {
    const row = await this.db
      .selectFrom("app_metric_values")
      .select([
        sql<number>`count(distinct user_did)::int`.as("total"),
        sql<number>`(count(distinct user_did) filter (where updated_at >= ${since.toISOString()}::timestamptz))::int`.as(
          "active",
        ),
        sql<Date | string | null>`max(updated_at)`.as("latest"),
      ])
      .where("app_did", "=", appDid)
      .executeTakeFirstOrThrow();
    return {
      totalUsers: Number(row.total),
      activeUsers: Number(row.active),
      updatedAt: row.latest === null ? null : new Date(row.latest),
    };
  }

  async userStatsDocumentsPage(limit: number, afterUserDid?: string): Promise<UserStatsDocumentEntry[]> {
    let query = this.db
      .selectFrom("user_stats_documents")
      .select(["user_did", "document_id"])
      .orderBy("user_did")
      .limit(limit);
    if (afterUserDid !== undefined) query = query.where("user_did", ">", afterUserDid);
    const rows = await query.execute();
    return rows.map((row) => ({ userDid: row.user_did, documentId: row.document_id }));
  }

  async jobDone(name: string): Promise<boolean> {
    const row = await this.db
      .selectFrom("renown_stats_jobs")
      .select("name")
      .where("name", "=", name)
      .executeTakeFirst();
    return row !== undefined;
  }

  async markJobDone(name: string, at: Date): Promise<void> {
    await this.db
      .insertInto("renown_stats_jobs")
      .values({ name, completed_at: at })
      .onConflict((oc) => oc.column("name").doNothing())
      .execute();
  }
}
```

- [ ] **Step 4: Run the store tests, types, lint.** `pnpm exec vitest run subgraphs/renown-stats 2>&1 | tail -15` → PASS (every renown-stats suite). If the `ON CONFLICT … WHERE app_metric_values.updated_at` reference is rejected on the schema-qualified table, alias it instead: `.insertInto("app_metric_values as v")` and `v.updated_at <= excluded.updated_at`, then re-run. `pnpm tsc 2>&1 | tail -5`, `pnpm lint 2>&1 | tail -5` → no errors.

- [ ] **Step 5: Commit.**

```bash
git add subgraphs/renown-stats/store/migrations.ts subgraphs/renown-stats/store/types.ts subgraphs/renown-stats/store/kysely.ts subgraphs/renown-stats/tests/store-metrics.test.ts
git commit -m "feat(renown-stats): per-user metric values with app-level aggregates"
```

### Task 3: One-time backfill of metric values, run at setup

**Files:**
- Create: `subgraphs/renown-stats/core/backfill.ts`
- Modify: `subgraphs/renown-stats/index.ts`
- Test: `subgraphs/renown-stats/tests/backfill.test.ts`, `subgraphs/renown-stats/tests/subgraph.test.ts` (append)

**Interfaces:**
- Consumes: Task 2 `StatsIndex.userStatsDocumentsPage`, `recordMetricValues`, `jobDone`, `markJobDone`; `RenownUserStatsDocument` (`document-models/renown-user-stats`).
- Produces:
  - `METRIC_BACKFILL_JOB = "app-metric-values-backfill-v1"`; `backfillAppMetricValues(deps: { index: StatsIndex; reactorClient: Pick<IReactorClient, "get">; now: () => Date; logger?: Pick<Console, "info" | "warn">; pageSize?: number }): Promise<BackfillResult>`; `interface BackfillResult { status: "done" | "skipped" | "incomplete"; documents: number; values: number; failed: number }` (`core/backfill.ts`).
  - `RenownStatsSubgraph.backfillSettled(): Promise<void>` (resolves when the setup backfill finished, successfully or not).

- [ ] **Step 1: Write the failing tests.**

Create `subgraphs/renown-stats/tests/backfill.test.ts` with exactly:

```ts
import { PGlite } from "@electric-sql/pglite";
import type { PHDocument } from "document-model";
import { Kysely, sql } from "kysely";
import { PGliteDialect } from "kysely-pglite-dialect";
import { afterAll, describe, expect, it, vi } from "vitest";
import { reducer, setStat, setUserDid, utils } from "../../../document-models/renown-user-stats/index.js";
import { backfillAppMetricValues, METRIC_BACKFILL_JOB } from "../core/backfill.js";
import { KyselyStatsIndex } from "../store/kysely.js";
import { migrate } from "../store/migrations.js";
import type { StatsDB } from "../store/types.js";

const APP = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";
const ALICE = "did:pkh:eip155:1:0x1111111111111111111111111111111111111111";
const BOB = "did:pkh:eip155:1:0x2222222222222222222222222222222222222222";
const T1 = "2026-10-01T00:00:00.000Z";
const T2 = "2026-10-08T00:00:00.000Z";

const opened: Kysely<StatsDB>[] = [];
afterAll(async () => {
  await Promise.all(opened.map((db) => db.destroy()));
});

async function makeIndex() {
  const root = new Kysely<StatsDB>({ dialect: new PGliteDialect(new PGlite()) });
  opened.push(root);
  await sql`create schema "renown-stats"`.execute(root);
  const db = root.withSchema("renown-stats");
  await migrate(db);
  return { index: new KyselyStatsIndex(db), db };
}

/** A user-stats document with the given stats, as reportUserStat leaves it. */
function statsDoc(userDid: string, stats: { metric: string; value: number; updatedAt: string }[]): PHDocument {
  let doc = reducer(utils.createDocument(), setUserDid({ userDid }));
  stats.forEach((s, i) => {
    doc = reducer(doc, setStat({ id: `${userDid}-${i}`, appDid: APP, ...s }));
  });
  return doc as unknown as PHDocument;
}

function reactorWith(docs: Record<string, PHDocument>) {
  return {
    get: vi.fn((id: string) => (docs[id] ? Promise.resolve(docs[id]) : Promise.reject(new Error(`no document ${id}`)))),
  };
}

const quiet = { info: vi.fn(), warn: vi.fn() };
const now = () => new Date("2026-10-09T00:00:00Z");

describe("backfillAppMetricValues", () => {
  it("copies every user's current values once, then skips", async () => {
    const { index } = await makeIndex();
    await index.claimUserStatsDocument(ALICE, "doc-a", now());
    await index.claimUserStatsDocument(BOB, "doc-b", now());
    const reactor = reactorWith({
      "doc-a": statsDoc(ALICE, [
        { metric: "notes", value: 4, updatedAt: T1 },
        { metric: "streak", value: 2, updatedAt: T2 },
      ]),
      "doc-b": statsDoc(BOB, [{ metric: "notes", value: 0, updatedAt: T2 }]),
    });
    const result = await backfillAppMetricValues({ index, reactorClient: reactor, now, logger: quiet, pageSize: 1 });
    expect(result).toEqual({ status: "done", documents: 2, values: 3, failed: 0 });
    expect(await index.jobDone(METRIC_BACKFILL_JOB)).toBe(true);
    const [notes] = await index.metricAggregates(APP, ["notes"], 5);
    expect(notes).toMatchObject({ users: 2, sum: 4, positiveUsers: 1 });
    expect(await index.appActivity(APP, new Date(T2))).toMatchObject({ totalUsers: 2, activeUsers: 2 });

    reactor.get.mockClear();
    expect(await backfillAppMetricValues({ index, reactorClient: reactor, now, logger: quiet })).toEqual({
      status: "skipped",
      documents: 0,
      values: 0,
      failed: 0,
    });
    expect(reactor.get).not.toHaveBeenCalled();
  });

  it("never overwrites a newer live value", async () => {
    const { index } = await makeIndex();
    await index.claimUserStatsDocument(ALICE, "doc-a", now());
    await index.recordMetricValues([
      { appDid: APP, metric: "notes", userDid: ALICE, value: 9, updatedAt: new Date("2026-10-09T00:00:00Z") },
    ]);
    const reactor = reactorWith({ "doc-a": statsDoc(ALICE, [{ metric: "notes", value: 4, updatedAt: T1 }]) });
    await backfillAppMetricValues({ index, reactorClient: reactor, now, logger: quiet });
    expect((await index.metricAggregates(APP, ["notes"], 1))[0]?.sum).toBe(9);
  });

  it("leaves the job open when a document cannot be read, and finishes on a later run", async () => {
    const { index } = await makeIndex();
    await index.claimUserStatsDocument(ALICE, "doc-a", now());
    await index.claimUserStatsDocument(BOB, "doc-b", now());
    const docs: Record<string, PHDocument> = { "doc-a": statsDoc(ALICE, [{ metric: "notes", value: 4, updatedAt: T1 }]) };
    const warn = vi.fn();
    const first = await backfillAppMetricValues({ index, reactorClient: reactorWith(docs), now, logger: { info: vi.fn(), warn } });
    expect(first).toEqual({ status: "incomplete", documents: 1, values: 1, failed: 1 });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("doc-b"));
    expect(await index.jobDone(METRIC_BACKFILL_JOB)).toBe(false);

    docs["doc-b"] = statsDoc(BOB, [{ metric: "notes", value: 1, updatedAt: T2 }]);
    const second = await backfillAppMetricValues({ index, reactorClient: reactorWith(docs), now, logger: quiet });
    expect(second.status).toBe("done");
    // Re-copying Alice changed nothing: still one row per user.
    expect((await index.metricAggregates(APP, ["notes"], 5))[0]).toMatchObject({ users: 2, sum: 5 });
  });
});
```

Append to the end of `subgraphs/renown-stats/tests/subgraph.test.ts`:

```ts
describe("RenownStatsSubgraph metric backfill", () => {
  it("runs the one-time backfill at setup and records it", async () => {
    let namespace: Kysely<any> | undefined;
    const { subgraph } = makeSubgraph(async () => {
      namespace = (await pgliteNamespace()) as Kysely<any>;
      return namespace;
    });
    await subgraph.onSetup();
    await subgraph.backfillSettled();
    const jobs = await namespace!.selectFrom("renown_stats_jobs").select("name").execute();
    expect(jobs.map((job) => job.name)).toEqual(["app-metric-values-backfill-v1"]);
  });
});
```

- [ ] **Step 2: Run them to see them fail.** `pnpm exec vitest run subgraphs/renown-stats/tests/backfill.test.ts subgraphs/renown-stats/tests/subgraph.test.ts 2>&1 | tail -15` → FAIL (`Cannot find module '../core/backfill.js'`; `subgraph.backfillSettled is not a function`).

- [ ] **Step 3: Implement.**

Create `subgraphs/renown-stats/core/backfill.ts` with exactly:

```ts
import type { IReactorClient } from "@powerhousedao/reactor";
import type { RenownUserStatsDocument } from "../../../document-models/renown-user-stats/index.js";
import type { MetricValue, StatsIndex } from "../store/types.js";

/** The job name in renown_stats_jobs; bump the suffix to run a new backfill. */
export const METRIC_BACKFILL_JOB = "app-metric-values-backfill-v1";

export interface BackfillResult {
  status: "done" | "skipped" | "incomplete";
  documents: number;
  values: number;
  failed: number;
}

export interface BackfillDeps {
  index: StatsIndex;
  reactorClient: Pick<IReactorClient, "get">;
  now: () => Date;
  logger?: Pick<Console, "info" | "warn">;
  /** User-stats documents read per page (default 200). */
  pageSize?: number;
}

/**
 * Builds app_metric_values from every existing renown-user-stats document,
 * once. Idempotent: rows are upserted "newer updatedAt wins", so a re-run,
 * or a run racing live reports, never regresses a value. A document that
 * cannot be read is logged and leaves the job open, so the next start
 * retries the whole (cheap, idempotent) pass.
 */
export async function backfillAppMetricValues(deps: BackfillDeps): Promise<BackfillResult> {
  const { index } = deps;
  const logger = deps.logger ?? console;
  const pageSize = deps.pageSize ?? 200;
  if (await index.jobDone(METRIC_BACKFILL_JOB)) {
    return { status: "skipped", documents: 0, values: 0, failed: 0 };
  }
  let documents = 0;
  let values = 0;
  let failed = 0;
  let after: string | undefined;
  for (;;) {
    const page = await index.userStatsDocumentsPage(pageSize, after);
    for (const entry of page) {
      try {
        const doc = await deps.reactorClient.get<RenownUserStatsDocument>(entry.documentId);
        const rows: MetricValue[] = doc.state.global.stats.map((stat) => ({
          appDid: stat.appDid,
          metric: stat.metric,
          userDid: entry.userDid,
          value: stat.value,
          updatedAt: new Date(stat.updatedAt),
        }));
        await index.recordMetricValues(rows);
        documents++;
        values += rows.length;
      } catch (error) {
        failed++;
        const reason = error instanceof Error ? error.message : String(error);
        logger.warn(
          `[renown-stats] metric backfill of ${entry.documentId} failed (${reason}); retried on the next start`,
        );
      }
    }
    const last = page.at(-1);
    if (page.length < pageSize || !last) break;
    after = last.userDid;
  }
  if (failed > 0) return { status: "incomplete", documents, values, failed };
  await index.markJobDone(METRIC_BACKFILL_JOB, deps.now());
  if (documents > 0) {
    logger.info(`[renown-stats] backfilled ${values} metric values from ${documents} user-stats documents`);
  }
  return { status: "done", documents, values, failed };
}
```

In `subgraphs/renown-stats/index.ts`:
1. Add `import { backfillAppMetricValues } from "./core/backfill.js";` below `import { createResolvers } from "./resolvers.js";`.
2. Replace `  #setUp = false;` with:

```ts
  #setUp = false;
  #backfill: Promise<void> = Promise.resolve();
```

3. Replace:

```ts
      await migrate(db);
      this.#index = new KyselyStatsIndex(db);
```

with:

```ts
      await migrate(db);
      const index = new KyselyStatsIndex(db);
      this.#index = index;
      // One-time and idempotent: app_metric_values from the user-stats
      // documents written before Phase 3. In the background, so the host's
      // startup never waits for it.
      this.#backfill = backfillAppMetricValues({
        index,
        reactorClient: this.reactorClient,
        now: () => new Date(),
      }).then(
        () => undefined,
        (error: unknown) => {
          const reason = error instanceof Error ? error.message : "unknown error";
          console.warn(`[renown-stats] metric backfill failed (${reason}); retried on the next start`);
        },
      );
```

4. Replace:

```ts
  onDisconnect(): Promise<void> {
```

with:

```ts
  /** Resolves once the setup backfill has finished (successfully or not). */
  backfillSettled(): Promise<void> {
    return this.#backfill;
  }

  onDisconnect(): Promise<void> {
```

- [ ] **Step 4: Run tests, types, lint.** `pnpm exec vitest run subgraphs/renown-stats 2>&1 | tail -15` → PASS (the existing subgraph tests stay green: a fresh namespace has no documents, so the backfill never calls the reactor and never warns). `pnpm tsc 2>&1 | tail -5`, `pnpm lint 2>&1 | tail -5` → no errors.

- [ ] **Step 5: Commit.**

```bash
git add subgraphs/renown-stats/core/backfill.ts subgraphs/renown-stats/index.ts subgraphs/renown-stats/tests/backfill.test.ts subgraphs/renown-stats/tests/subgraph.test.ts
git commit -m "feat(renown-stats): backfill app metric values from user-stats documents once"
```

### Task 4: Metric definitions through `upsertAppProfile`; aggregates on every report

**Files:**
- Create: `subgraphs/renown-stats/core/app-metrics-patch.ts`, `subgraphs/renown-stats/tests/harness.ts`
- Modify: `subgraphs/renown-stats/resolvers.ts`, `subgraphs/renown-stats/schema.ts`, `subgraphs/renown-stats/README.md`, `subgraphs/renown-stats/tests/resolvers.test.ts` (one expectation)
- Test: `subgraphs/renown-stats/tests/app-metrics.test.ts`

**Interfaces:**
- Consumes: Task 1 (`actions.addMetric/updateMetric/removeMetric/reorderMetrics`, `isMetricKey`, `MAX_METRICS`, `MAX_METRIC_*`, `METRIC_AGGREGATIONS`, `RenownAppMetric`, `RenownMetricAggregation`); Task 2 `StatsIndex.recordMetricValues`; Phase 2 Task 4 (`resolvers.ts` as replaced there, `AppProfileInputError`, `REGISTRAR_HEADER`, the relay gate).
- Produces:
  - `core/app-metrics-patch.ts`: `interface AppMetricInput { id: string; key: string; label: string; unit?: string | null; description?: string | null; aggregation: string; public: boolean }`; `interface AppMetric { id: string; key: string; label: string; unit: string | null; description: string | null; aggregation: RenownMetricAggregation; public: boolean }`; `toAppMetric(metric: RenownAppMetric): AppMetric`; `toMetricsPatch(input: readonly AppMetricInput[] | null | undefined): AppMetric[] | undefined` (throws `AppProfileInputError("metrics", …)`); `metricActions(current: readonly AppMetric[], desired: readonly AppMetric[]): Action[]`.
  - GraphQL (`/graphql/renown-stats`): `enum RenownMetricAggregation { SUM MAX AVG COUNT_USERS }`; `type AppMetric { id: String!, key: String!, label: String!, unit: String, description: String, aggregation: RenownMetricAggregation!, public: Boolean! }`; `AppProfile.metrics: [AppMetric!]!`; `input AppMetricInput { id: String!, key: String!, label: String!, unit: String, description: String, aggregation: RenownMetricAggregation!, public: Boolean! }`; `upsertAppProfile(…, metrics: [AppMetricInput!]): Boolean!` (errors as Phase 2; bad metrics → `BAD_USER_INPUT` with `extensions.field = "metrics"`).
  - Behaviour: every accepted `reportUserStat` (changed or unchanged value) upserts its `app_metric_values` row with `updatedAt = now()`.
  - Test harness `tests/harness.ts`: `openHarness()`, `resetHarness(h)`, `registerApp(h, appDid, owner?)`, `insertProfile(h, row)`, `fakeReactor()`, `harnessResolvers(h, options?)`, `relayed(address?)`, `failure(promise)`, constants `OWNER`, `TOKEN`, `USER_NS`, `STATS_NS`.

- [ ] **Step 1: Write the harness and the failing tests.**

Create `subgraphs/renown-stats/tests/harness.ts` with exactly:

```ts
import { PGlite } from "@electric-sql/pglite";
import type { IRelationalDb } from "@powerhousedao/reactor-browser";
import { generateId, type Action, type PHDocument } from "document-model";
import { GraphQLError } from "graphql";
import { Kysely, sql } from "kysely";
import { PGliteDialect } from "kysely-pglite-dialect";
import { getAddress } from "viem";
import { expect, vi } from "vitest";
import {
  reducer as profileReducer,
  renownAppProfileDocumentType,
  utils as profileUtils,
} from "../../../document-models/renown-app-profile/index.js";
import {
  reducer as statsReducer,
  renownUserStatsDocumentType,
  utils as statsUtils,
} from "../../../document-models/renown-user-stats/index.js";
import { RenownCredentialProcessor } from "../../../processors/renown-credential/index.js";
import { up as upCredential } from "../../../processors/renown-credential/migrations.js";
import { RenownUserProcessor } from "../../../processors/renown-user/index.js";
import { up as upUser } from "../../../processors/renown-user/migrations.js";
import { migrate as migrateWorkload } from "../../renown-workload/store/migrations.js";
import { REGISTRAR_HEADER } from "../core/config.js";
import { createResolvers, type StatsResolverDeps } from "../resolvers.js";
import { KyselyStatsIndex } from "../store/kysely.js";
import { migrate } from "../store/migrations.js";

// Shared by the Phase 3 suites: one PGlite with every namespace renown-stats
// reads (its own, renown-workload, the credential and user read models).

export const OWNER = "0xabc0000000000000000000000000000000000001";
/** RENOWN_WORKLOAD_REGISTRATION_TOKEN as the Vetra relay sends it. */
export const TOKEN = "registration-token-for-tests";
/** What a browser bearer carries as appKey: a random per-browser did:key. */
export const BROWSER_KEY = "did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH";
export const CRED_NS = RenownCredentialProcessor.getNamespace("renown-credential");
export const USER_NS = RenownUserProcessor.getNamespace("renown-user");
export const STATS_NS = "renown-stats";
export const WORKLOAD_NS = "renown-workload";
const T0 = new Date("2026-10-01T00:00:00Z");

export interface Harness {
  root: Kysely<any>;
  relationalDb: IRelationalDb<unknown>;
}

export async function openHarness(): Promise<Harness> {
  const root = new Kysely<any>({ dialect: new PGliteDialect(new PGlite()) });
  await sql`create schema ${sql.id(CRED_NS)}`.execute(root);
  await upCredential(root.withSchema(CRED_NS) as never);
  await sql`create schema ${sql.id(USER_NS)}`.execute(root);
  await upUser(root.withSchema(USER_NS) as never);
  await sql`create schema ${sql.id(STATS_NS)}`.execute(root);
  await migrate(root.withSchema(STATS_NS));
  await sql`create schema ${sql.id(WORKLOAD_NS)}`.execute(root);
  await migrateWorkload(root.withSchema(WORKLOAD_NS));
  const relationalDb = {
    queryNamespace: (namespace: string) => root.withSchema(namespace),
  } as unknown as IRelationalDb<unknown>;
  return { root, relationalDb };
}

export async function resetHarness(h: Harness): Promise<void> {
  for (const table of [
    "user_stats_documents",
    "app_profile_documents",
    "app_profile_images",
    "app_metric_values",
    "renown_stats_jobs",
  ]) {
    await h.root.withSchema(STATS_NS).deleteFrom(table).execute();
  }
  await h.root.withSchema(WORKLOAD_NS).deleteFrom("workload_identities").execute();
  await h.root.withSchema(CRED_NS).deleteFrom("renown_credential").execute();
  await h.root.withSchema(USER_NS).deleteFrom("renown_user").execute();
}

/** `appDid` as a workload identity of `owner`, who holds a live delegation to it: it may report. */
export async function registerApp(h: Harness, appDid: string, owner = OWNER): Promise<void> {
  await h.root
    .withSchema(WORKLOAD_NS)
    .insertInto("workload_identities")
    .values({
      did: appDid,
      provider: "github",
      repository_id: generateId(),
      repository: "acme/app",
      production_branch: "main",
      owner_address: getAddress(owner),
      chain_id: 1,
      encrypted_key_pair: "sealed",
      created_at: T0,
      updated_at: T0,
    })
    .execute();
  await h.root
    .withSchema(CRED_NS)
    .insertInto("renown_credential")
    .values({
      document_id: generateId(),
      context: "[]",
      credential_id: generateId(),
      type: "[]",
      issuer_id: `did:pkh:eip155:1:${owner}`,
      issuer_ethereum_address: owner,
      issuance_date: T0,
      expiration_date: new Date("2027-10-01T00:00:00Z"),
      credential_subject_id: appDid,
      credential_subject_app: "test-app",
      credential_status_id: null,
      credential_status_type: null,
      credential_schema_id: "schema",
      credential_schema_type: "type",
      proof_verification_method: "method",
      proof_ethereum_address: owner,
      proof_created: T0,
      proof_purpose: "assertionMethod",
      proof_type: "EthereumEip712Signature2021",
      proof_value: "0x",
      proof_eip712_domain: "{}",
      proof_eip712_primary_type: "VerifiableCredential",
      revoked: false,
      revoked_at: null,
      revocation_reason: null,
    })
    .execute();
}

/** A Renown profile row, as the Phase 1 renown-user processor writes it. */
export async function insertProfile(
  h: Harness,
  row: {
    address: string;
    documentId: string;
    handle?: string | null;
    displayName?: string | null;
    avatarRef?: string | null;
    userImage?: string | null;
  },
): Promise<void> {
  await h.root
    .withSchema(USER_NS)
    .insertInto("renown_user")
    .values({
      document_id: row.documentId,
      eth_address: row.address,
      username: null,
      user_image: row.userImage ?? null,
      display_name: row.displayName ?? null,
      handle: row.handle ?? null,
      bio: null,
      links: "[]",
      avatar_ref: row.avatarRef ?? null,
      created_at: T0,
      updated_at: T0,
    })
    .execute();
}

/** A reactor client over the real reducers, in memory. */
export function fakeReactor() {
  const docs = new Map<string, PHDocument>();
  const reducers: Record<string, (doc: PHDocument, action: Action) => PHDocument> = {
    [renownUserStatsDocumentType]: statsReducer as never,
    [renownAppProfileDocumentType]: profileReducer as never,
  };
  const creators: Record<string, () => PHDocument> = {
    [renownUserStatsDocumentType]: () => statsUtils.createDocument() as never,
    [renownAppProfileDocumentType]: () => profileUtils.createDocument() as never,
  };
  return {
    docs,
    createEmpty: vi.fn((documentType: string) => {
      const doc = creators[documentType]();
      docs.set(doc.header.id, doc);
      return Promise.resolve(doc);
    }),
    execute: vi.fn((id: string, _branch: string, actions: Action[]) => {
      let doc = docs.get(id);
      if (!doc) return Promise.reject(new Error(`no document ${id}`));
      for (const action of actions) doc = reducers[doc.header.documentType](doc, action);
      docs.set(id, doc);
      return Promise.resolve(doc);
    }),
    get: vi.fn((id: string) => {
      const doc = docs.get(id);
      return doc ? Promise.resolve(doc) : Promise.reject(new Error(`no document ${id}`));
    }),
  };
}

export type Ctx = {
  user?: { address?: string; appKey?: string };
  headers?: Record<string, string>;
};
type Resolver = (parent: unknown, args: Record<string, unknown>, ctx: Ctx) => Promise<unknown>;

/** The Vetra relay: the wallet's own browser bearer plus the registration token. */
export const relayed = (address = OWNER): Ctx => ({
  user: { address, appKey: BROWSER_KEY },
  headers: { [REGISTRAR_HEADER]: TOKEN },
});

/** Resolvers over the harness. `now` defaults to a clock that ticks one second per call. */
export function harnessResolvers(
  h: Harness,
  options: { now?: () => Date; relationalDb?: IRelationalDb<unknown> } = {},
) {
  const reactor = fakeReactor();
  const index = new KyselyStatsIndex(h.root.withSchema(STATS_NS));
  let tick = 0;
  const resolvers = createResolvers({
    reactorClient: reactor as unknown as StatsResolverDeps["reactorClient"],
    relationalDb: (options.relationalDb ?? h.relationalDb) as StatsResolverDeps["relationalDb"],
    index: () => index,
    audience: () => "https://stats.example/graphql/renown-stats",
    profileApps: () => new Set<string>(),
    registrationToken: () => TOKEN,
    media: () => null,
    now: options.now ?? (() => new Date(Date.UTC(2026, 9, 9, 12, 0, tick++))),
  }) as { Query: Record<string, Resolver>; Mutation: Record<string, Resolver> };
  return {
    reactor,
    index,
    /** reportUserStat as the app itself (a host bearer signed by the app DID, for its owner). */
    report: (args: { appDid: string; userDid: string; metric: string; value: number }) =>
      resolvers.Mutation.reportUserStat(null, args, { user: { address: OWNER, appKey: args.appDid } }),
    upsert: (args: Record<string, unknown>, ctx: Ctx = relayed()) =>
      resolvers.Mutation.upsertAppProfile(null, args, ctx),
    appProfile: (appDid: string) => resolvers.Query.appProfile(null, { appDid }, {}),
    appStats: (appDid: string) => resolvers.Query.appStats(null, { appDid }, {}),
    userStats: (userDid: string) => resolvers.Query.userStats(null, { userDid }, {}),
  };
}

/** The GraphQL error `promise` rejects with (fails the test if it resolves). */
export async function failure(
  promise: Promise<unknown>,
): Promise<{ code: unknown; field: unknown; message: string }> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(GraphQLError);
  const e = error as GraphQLError;
  return { code: e.extensions.code, field: e.extensions.field, message: e.message };
}
```

Create `subgraphs/renown-stats/tests/app-metrics.test.ts` with exactly:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { metricActions, toMetricsPatch, type AppMetric } from "../core/app-metrics-patch.js";
import { pkhDidFor } from "../core/dids.js";
import {
  failure,
  harnessResolvers,
  openHarness,
  registerApp,
  resetHarness,
  type Harness,
} from "./harness.js";

const APP = "did:key:zDnaerDaTF5BXEavCrfRZEk316dpbLsfPDZ3WJ5hRTPFU2169";
const USER = pkhDidFor("0x1111111111111111111111111111111111111111");
const NOTES = { id: "m1", key: "notes", label: "Notes", unit: "notes", description: "Notes written", aggregation: "SUM", public: true };
const STREAK = { id: "m2", key: "streak", label: "Best streak", unit: null, description: null, aggregation: "MAX", public: false };

let h: Harness;
beforeAll(async () => {
  h = await openHarness();
});
afterAll(async () => {
  await h.root.destroy();
});
beforeEach(async () => {
  await resetHarness(h);
  await registerApp(h, APP);
});

type Profile = { metrics: AppMetric[] } | null;

describe("upsertAppProfile metrics", () => {
  it("declares metrics through the relay and reads them back, trimmed", async () => {
    const r = harnessResolvers(h);
    expect(await r.upsert({ appDid: APP, name: "Vault", metrics: [{ ...NOTES, label: " Notes ", unit: " notes " }, STREAK] })).toBe(true);
    expect(((await r.appProfile(APP)) as Profile)?.metrics).toEqual([NOTES, STREAK]);
  });

  it("replaces the whole list: edits, removes, adds and reorders; [] clears", async () => {
    const r = harnessResolvers(h);
    await r.upsert({ appDid: APP, metrics: [NOTES, STREAK] });
    const score = { id: "m3", key: "score", label: "Score", aggregation: "AVG", public: true };
    await r.upsert({ appDid: APP, metrics: [score, { ...NOTES, unit: "", public: false }] });
    expect(((await r.appProfile(APP)) as Profile)?.metrics).toEqual([
      { ...score, unit: null, description: null },
      { ...NOTES, unit: null, public: false },
    ]);
    // Unchanged metrics send nothing.
    const before = r.reactor.execute.mock.calls.length;
    await r.upsert({ appDid: APP, metrics: [score, { ...NOTES, unit: "", public: false }] });
    expect(r.reactor.execute.mock.calls.length).toBe(before);
    await r.upsert({ appDid: APP, metrics: [] });
    expect(((await r.appProfile(APP)) as Profile)?.metrics).toEqual([]);
  });

  it("swaps keys between two metrics in one save", async () => {
    const r = harnessResolvers(h);
    await r.upsert({ appDid: APP, metrics: [NOTES, { ...STREAK }] });
    expect(await r.upsert({ appDid: APP, metrics: [{ ...NOTES, key: "streak" }, { ...STREAK, key: "notes" }] })).toBe(true);
    const metrics = ((await r.appProfile(APP)) as Profile)?.metrics ?? [];
    expect(metrics.map((m) => [m.id, m.key])).toEqual([
      ["m1", "streak"],
      ["m2", "notes"],
    ]);
  });

  it("rejects invalid metric lists before anything is written", async () => {
    const r = harnessResolvers(h);
    const many = Array.from({ length: 17 }, (_, i) => ({ ...NOTES, id: `m${i}`, key: `k${i}` }));
    const cases: unknown[][] = [
      many,
      [NOTES, { ...STREAK, id: "m1" }],
      [NOTES, { ...STREAK, key: "notes" }],
      [{ ...NOTES, key: "9lives" }],
      [{ ...NOTES, label: "  " }],
      [{ ...NOTES, label: "l".repeat(41) }],
      [{ ...NOTES, unit: "u".repeat(17) }],
      [{ ...NOTES, description: "d".repeat(201) }],
      [{ ...NOTES, aggregation: "MEDIAN" }],
    ];
    for (const metrics of cases) {
      expect(await failure(r.upsert({ appDid: APP, metrics }))).toMatchObject({ code: "BAD_USER_INPUT", field: "metrics" });
    }
    expect(await r.appProfile(APP)).toBeNull();
  });

  it("adds metrics to a legacy profile that has no metrics list", async () => {
    const r = harnessResolvers(h);
    await r.upsert({ appDid: APP, name: "Old" });
    for (const doc of r.reactor.docs.values()) delete (doc.state.global as Record<string, unknown>).metrics;
    expect(((await r.appProfile(APP)) as Profile)?.metrics).toEqual([]);
    await r.upsert({ appDid: APP, metrics: [NOTES] });
    expect(((await r.appProfile(APP)) as Profile)?.metrics).toEqual([NOTES]);
  });
});

describe("metricActions", () => {
  const a = toMetricsPatch([NOTES])?.[0] as AppMetric;
  const b = toMetricsPatch([STREAK])?.[0] as AppMetric;
  const types = (current: AppMetric[], desired: AppMetric[]) => metricActions(current, desired).map((x) => x.type);

  it("sends the fewest operations", () => {
    expect(types([a, b], [a, b])).toEqual([]);
    expect(types([a, b], [{ ...a, label: "Notes!" }, b])).toEqual(["UPDATE_METRIC"]);
    expect(types([a, b], [b, a])).toEqual(["REORDER_METRICS"]);
    expect(types([a, b], [a])).toEqual(["REMOVE_METRIC"]);
    expect(types([a], [a, b])).toEqual(["ADD_METRIC"]);
    expect(types([a, b], [{ ...a, key: "renamed" }, b])).toEqual(["REMOVE_METRIC", "ADD_METRIC", "REORDER_METRICS"]);
    expect(toMetricsPatch(null)).toBeUndefined();
    expect(toMetricsPatch(undefined)).toBeUndefined();
  });
});

describe("reportUserStat aggregates", () => {
  it("upserts the app's metric value on every accepted report, changed or not", async () => {
    const r = harnessResolvers(h);
    await r.report({ appDid: APP, userDid: USER, metric: "notes", value: 5 });
    const first = await r.index.appActivity(APP, new Date(0));
    await r.report({ appDid: APP, userDid: USER, metric: "notes", value: 5 });
    const second = await r.index.appActivity(APP, new Date(0));
    expect(second.updatedAt!.getTime()).toBeGreaterThan(first.updatedAt!.getTime());
    await r.report({ appDid: APP, userDid: USER, metric: "notes", value: 0 });
    expect(await r.index.metricAggregates(APP, ["notes"], 5)).toEqual([
      { metric: "notes", users: 1, sum: 0, max: 0, avg: 0, positiveUsers: 0, top: [{ userDid: USER, value: 0 }] },
    ]);
  });

  it("writes no value for a report the document rejected", async () => {
    const r = harnessResolvers(h);
    for (let i = 0; i < 32; i++) await r.report({ appDid: APP, userDid: USER, metric: `m${i}`, value: 1 });
    expect(await failure(r.report({ appDid: APP, userDid: USER, metric: "m32", value: 1 }))).toMatchObject({
      code: "BAD_USER_INPUT",
    });
    expect(await r.index.metricAggregates(APP, ["m32"], 5)).toEqual([]);
  });
});
```

In `subgraphs/renown-stats/tests/resolvers.test.ts` (the expectation Phase 2 Task 4 extended) replace:

```ts
      coverRef: null,
      links: [],
    };
```

with:

```ts
      coverRef: null,
      links: [],
      metrics: [],
    };
```

- [ ] **Step 2: Run them to see them fail.** `pnpm exec vitest run subgraphs/renown-stats 2>&1 | tail -20` → FAIL (`Cannot find module '../core/app-metrics-patch.js'`; the existing first upsert test misses `metrics`).

- [ ] **Step 3: Implement.**

Create `subgraphs/renown-stats/core/app-metrics-patch.ts` with exactly:

```ts
import type { Action } from "document-model";
import {
  actions as appActions,
  isMetricKey,
  MAX_METRIC_DESCRIPTION_LENGTH,
  MAX_METRIC_LABEL_LENGTH,
  MAX_METRIC_UNIT_LENGTH,
  MAX_METRICS,
  METRIC_AGGREGATIONS,
  type RenownAppMetric,
  type RenownMetricAggregation,
} from "../../../document-models/renown-app-profile/index.js";
import { AppProfileInputError } from "./app-profile-patch.js";

/** One metric as upsertAppProfile receives it (AppMetricInput). */
export interface AppMetricInput {
  id: string;
  key: string;
  label: string;
  unit?: string | null;
  description?: string | null;
  aggregation: string;
  public: boolean;
}

/** A validated, trimmed metric definition; null unit/description means none. */
export interface AppMetric {
  id: string;
  key: string;
  label: string;
  unit: string | null;
  description: string | null;
  aggregation: RenownMetricAggregation;
  public: boolean;
}

const AGGREGATIONS: ReadonlySet<string> = new Set(METRIC_AGGREGATIONS);

function isAggregation(value: string): value is RenownMetricAggregation {
  return AGGREGATIONS.has(value);
}

function optionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

const bad = (message: string) => new AppProfileInputError("metrics", message);

/** A stored metric as the API returns it. */
export function toAppMetric(metric: RenownAppMetric): AppMetric {
  return {
    id: metric.id,
    key: metric.key,
    label: metric.label,
    unit: metric.unit ?? null,
    description: metric.description ?? null,
    aggregation: metric.aggregation,
    public: metric.public,
  };
}

/**
 * The validated whole desired list, or undefined when `input` is absent/null
 * (unchanged). Mirrors the model's rules so a bad list fails before any write.
 * @throws {AppProfileInputError} with field "metrics".
 */
export function toMetricsPatch(
  input: readonly AppMetricInput[] | null | undefined,
): AppMetric[] | undefined {
  if (input == null) return undefined;
  if (input.length > MAX_METRICS) throw bad(`A profile declares at most ${MAX_METRICS} metrics`);
  const ids = new Set<string>();
  const keys = new Set<string>();
  return input.map((raw) => {
    const key = raw.key.trim();
    const label = raw.label.trim();
    const unit = optionalText(raw.unit);
    const description = optionalText(raw.description);
    if (!raw.id || ids.has(raw.id)) throw bad("Every metric needs a unique id");
    if (!isMetricKey(key)) {
      throw bad(`Metric key "${key}" must start with a letter and use only letters, digits and _ . : - (at most 64)`);
    }
    if (keys.has(key)) throw bad(`Metric key "${key}" is declared twice`);
    if (label === "" || label.length > MAX_METRIC_LABEL_LENGTH) {
      throw bad(`Metric labels must be 1-${MAX_METRIC_LABEL_LENGTH} characters`);
    }
    if (unit !== null && unit.length > MAX_METRIC_UNIT_LENGTH) {
      throw bad(`Metric units must be at most ${MAX_METRIC_UNIT_LENGTH} characters`);
    }
    if (description !== null && description.length > MAX_METRIC_DESCRIPTION_LENGTH) {
      throw bad(`Metric descriptions must be at most ${MAX_METRIC_DESCRIPTION_LENGTH} characters`);
    }
    if (!isAggregation(raw.aggregation)) throw bad("aggregation must be SUM, MAX, AVG or COUNT_USERS");
    ids.add(raw.id);
    keys.add(key);
    return { id: raw.id, key, label, unit, description, aggregation: raw.aggregation, public: raw.public };
  });
}

function differs(a: AppMetric, b: AppMetric): boolean {
  return (
    a.label !== b.label ||
    a.unit !== b.unit ||
    a.description !== b.description ||
    a.aggregation !== b.aggregation ||
    a.public !== b.public
  );
}

/**
 * The renown-app-profile operations that turn `current` into `desired`:
 * removes (including every metric whose key changes), then updates, then
 * adds, then one reorder if the order still differs. A key change is a
 * remove + add with the same id, so keys can be swapped in one save without
 * a transient DuplicateMetricKeyError.
 */
export function metricActions(
  current: readonly AppMetric[],
  desired: readonly AppMetric[],
): Action[] {
  const wanted = new Map(desired.map((metric) => [metric.id, metric]));
  const removes: Action[] = [];
  const updates: Action[] = [];
  const kept: string[] = [];
  for (const metric of current) {
    const next = wanted.get(metric.id);
    if (!next || next.key !== metric.key) {
      removes.push(appActions.removeMetric({ id: metric.id }));
      continue;
    }
    kept.push(metric.id);
    if (differs(metric, next)) {
      updates.push(
        appActions.updateMetric({
          id: next.id,
          label: next.label,
          unit: next.unit ?? "",
          description: next.description ?? "",
          aggregation: next.aggregation,
          public: next.public,
        }),
      );
    }
  }
  const adds: Action[] = [];
  const order = [...kept];
  for (const next of desired) {
    if (kept.includes(next.id)) continue;
    adds.push(
      appActions.addMetric({
        id: next.id,
        key: next.key,
        label: next.label,
        unit: next.unit,
        description: next.description,
        aggregation: next.aggregation,
        public: next.public,
      }),
    );
    order.push(next.id);
  }
  const target = desired.map((metric) => metric.id);
  const reorder =
    order.join("\u0000") === target.join("\u0000")
      ? []
      : [appActions.reorderMetrics({ metricIds: target })];
  return [...removes, ...updates, ...adds, ...reorder];
}
```

In `subgraphs/renown-stats/resolvers.ts` (the file Phase 2 Task 4 replaced):

1. Replace:

```ts
  type RenownAppProfileDocument,
} from "../../document-models/renown-app-profile/index.js";
```

with:

```ts
  type RenownAppMetric,
  type RenownAppProfileDocument,
} from "../../document-models/renown-app-profile/index.js";
```

2. Replace `import { REGISTRAR_HEADER } from "./core/config.js";` with:

```ts
import {
  metricActions,
  toAppMetric,
  toMetricsPatch,
  type AppMetric,
  type AppMetricInput,
} from "./core/app-metrics-patch.js";
import { REGISTRAR_HEADER } from "./core/config.js";
```

3. Replace:

```ts
interface UpsertAppProfileArgs extends ProfileFields, RichProfileFields {
  appDid: string;
}
```

with:

```ts
interface UpsertAppProfileArgs extends ProfileFields, RichProfileFields {
  appDid: string;
  /** The whole desired metric list; absent or null leaves it unchanged. */
  metrics?: readonly AppMetricInput[] | null;
}
```

4. Replace:

```ts
  coverRef: string | null;
  links: AppProfileLink[];
}
```

with:

```ts
  coverRef: string | null;
  links: AppProfileLink[];
  metrics: AppMetric[];
}
```

5. Replace the whole `profileWrite` function (Phase 2 text: from its one-line doc comment directly above `  async function profileWrite(` through the function's closing `  }`) with:

```ts
  /** The actions that apply `fields`, `patch` and `metrics` to the profile document. */
  async function profileWrite(
    documentId: string,
    fields: ProfileFields,
    patch: RichProfilePatch,
    metrics: AppMetric[] | undefined,
  ): Promise<Action[]> {
    const scalars = {
      ...fields,
      description: patch.description,
      category: patch.category,
      logoRef: patch.logoRef,
      coverRef: patch.coverRef,
    };
    const actions: Action[] = [];
    if (Object.values(scalars).some((value) => value != null)) {
      actions.push(profileActions.setProfile(scalars));
    }
    if (patch.links || metrics) {
      const document =
        await reactorClient.get<RenownAppProfileDocument>(documentId);
      // Profiles from before links (Phase 2) or metrics (Phase 3) have no list at all.
      const state = document.state.global as {
        links?: AppProfileLink[];
        metrics?: RenownAppMetric[];
      };
      if (patch.links) actions.push(...appLinkActions(state.links ?? [], patch.links));
      if (metrics) {
        actions.push(...metricActions((state.metrics ?? []).map(toAppMetric), metrics));
      }
    }
    return actions;
  }
```

6. In `profileOutput`, replace:

```ts
        url,
      })),
    };
  }
```

with:

```ts
        url,
      })),
      metrics: (state.metrics ?? []).map(toAppMetric),
    };
  }
```

7. In `reportUserStat`, replace:

```ts
          if (stored?.value === args.value) return;
          await execute(documentId, [
            statsActions.setStat({
              id: generateId(),
              appDid,
              metric: args.metric,
              value: args.value,
              updatedAt: now().toISOString(),
            }),
          ]);
        });
```

with:

```ts
          const at = now();
          if (stored?.value !== args.value) {
            await execute(documentId, [
              statsActions.setStat({
                id: generateId(),
                appDid,
                metric: args.metric,
                value: args.value,
                updatedAt: at.toISOString(),
              }),
            ]);
          }
          // The app-level aggregate row, right after the accepted report and
          // under the same per-user lock. Every report rewrites it: it marks
          // the user active, and repairs a row a crash left behind.
          await index.recordMetricValues([
            { appDid, metric: args.metric, userDid, value: args.value, updatedAt: at },
          ]);
        });
```

8. In `upsertAppProfile`, replace:

```ts
        let patch: RichProfilePatch;
        try {
          patch = toRichProfilePatch(args);
        } catch (error) {
```

with:

```ts
        let patch: RichProfilePatch;
        let metrics: AppMetric[] | undefined;
        try {
          patch = toRichProfilePatch(args);
          metrics = toMetricsPatch(args.metrics);
        } catch (error) {
```

and replace `          const actions = await profileWrite(entry.documentId, fields, patch);` with `          const actions = await profileWrite(entry.documentId, fields, patch, metrics);`.

In `subgraphs/renown-stats/schema.ts` (the file Phase 2 Task 4 replaced):

1. Replace:

```ts
  type AppProfileLink {
    id: String!
    label: String!
    url: String!
  }
```

with:

```ts
  type AppProfileLink {
    id: String!
    label: String!
    url: String!
  }

  enum RenownMetricAggregation {
    SUM
    MAX
    AVG
    COUNT_USERS
  }

  "A publisher-defined metric: what the app reports as key, and how Renown shows it."
  type AppMetric {
    id: String!
    key: String!
    label: String!
    unit: String
    description: String
    aggregation: RenownMetricAggregation!
    "Shown on the app page and on user profiles."
    public: Boolean!
  }
```

2. Replace:

```ts
    links: [AppProfileLink!]!
  }
```

with:

```ts
    links: [AppProfileLink!]!
    metrics: [AppMetric!]!
  }
```

3. Replace:

```ts
  input AppProfileLinkInput {
    id: String!
    label: String!
    url: String!
  }
```

with:

```ts
  input AppProfileLinkInput {
    id: String!
    label: String!
    url: String!
  }

  input AppMetricInput {
    id: String!
    "^[A-Za-z][A-Za-z0-9_.:-]{0,63}$, unique per app"
    key: String!
    "1-40 characters"
    label: String!
    "At most 16 characters; empty means none"
    unit: String
    "At most 200 characters; empty means none"
    description: String
    aggregation: RenownMetricAggregation!
    public: Boolean!
  }
```

4. Replace:

```ts
      links: [AppProfileLinkInput!]
    ): Boolean!
```

with:

```ts
      links: [AppProfileLinkInput!]
      "The whole metric list (at most 16); [] clears."
      metrics: [AppMetricInput!]
    ): Boolean!
```

Append to `subgraphs/renown-stats/README.md`:

```markdown

## Metrics (identity hub phase 3)

Publishers declare what their app reports on its profile: `upsertAppProfile(metrics: [AppMetricInput!])` takes the whole list (`[]` clears; absent leaves it). Each metric: `key` (the reported metric name, `^[A-Za-z][A-Za-z0-9_.:-]{0,63}$`, unique), `label` (1–40), `unit` (≤ 16), `description` (≤ 200), `aggregation` (`SUM | MAX | AVG | COUNT_USERS`), `public`. At most 16 per app; bad lists are `BAD_USER_INPUT` with `extensions.field = "metrics"`. A changed key is applied as remove + add (same id), so keys can be swapped in one save.

Every accepted `reportUserStat` (changed value or not) also upserts `app_metric_values(app_did, metric, user_did, value, updated_at)` — right after the document write, under the same per-user lock (there is no shared transaction between documents and this table; the next report of the same value repairs a missed row). Rows are guarded "newer `updated_at` wins". Values reported before this existed are copied once at startup (job `app-metric-values-backfill-v1` in `renown_stats_jobs`; idempotent, retried on the next start until every user-stats document was read).
```

- [ ] **Step 4: Run everything.** `pnpm exec vitest run subgraphs/renown-stats document-models/renown-app-profile 2>&1 | tail -20` → PASS (the existing suites green apart from the edited expectation). `pnpm exec vitest run --coverage 2>&1 | grep -E "ERROR|Threshold|All files"` → thresholds pass. `pnpm tsc 2>&1 | tail -5`, `pnpm lint 2>&1 | tail -5` → no errors.

- [ ] **Step 5: Commit.**

```bash
git add subgraphs/renown-stats/core/app-metrics-patch.ts subgraphs/renown-stats/resolvers.ts subgraphs/renown-stats/schema.ts subgraphs/renown-stats/README.md subgraphs/renown-stats/tests/harness.ts subgraphs/renown-stats/tests/app-metrics.test.ts subgraphs/renown-stats/tests/resolvers.test.ts
git commit -m "feat(renown-stats): metric definitions on app profiles, aggregate rows on every report"
```

### Task 5: `appStats` and enriched `userStats`

**Files:**
- Create: `subgraphs/renown-stats/core/app-stats.ts`
- Modify: `subgraphs/renown-stats/lookups.ts`, `subgraphs/renown-stats/resolvers.ts`, `subgraphs/renown-stats/schema.ts`, `subgraphs/renown-stats/README.md`, `subgraphs/renown-stats/tests/resolvers.test.ts` (three expectations)
- Test: `subgraphs/renown-stats/tests/app-stats.test.ts`

**Interfaces:**
- Consumes: Task 2 `metricAggregates`, `appActivity`, `MetricAggregate`; Task 4 `AppMetric`, `toAppMetric`, harness; Phase 1 read model (`RenownUserProcessor`, `processors/renown-user/schema.ts` `DB.renown_user`).
- Produces:
  - `core/app-stats.ts`: `TOP_CONTRIBUTORS = 5`, `ACTIVE_WINDOW_MS = 30 days`, `metricValue(aggregation, aggregate | undefined): number`.
  - `lookups.ts`: `interface ContributorProfile { documentId: string; handle: string | null; displayName: string | null; hasAvatar: boolean; userImage: string | null }`, `contributorProfiles(db: ReadModelDb, addresses: readonly string[]): Promise<Map<string, ContributorProfile>>` (keys lowercase addresses; newest profile per address).
  - GraphQL (public): `appStats(appDid: String!): AppStats`; `type AppStats { appDid: String!, activeUsers30d: Int!, totalUsers: Int!, metrics: [AppMetricStat!]!, updatedAt: String }`; `type AppMetricStat { key: String!, label: String!, unit: String, description: String, aggregation: RenownMetricAggregation!, value: Float!, users: Int!, top: [MetricContributor!]! }`; `type MetricContributor { userDid: String!, value: Float!, address: String, handle: String, displayName: String, documentId: String, hasAvatar: Boolean!, userImage: String }`; `UserStat` gains `appName: String, appDocumentId: String, appHasLogo: Boolean!, appLogo: String, label: String, unit: String`.

- [ ] **Step 1: Write the failing tests.**

Create `subgraphs/renown-stats/tests/app-stats.test.ts` with exactly:

```ts
import type { IRelationalDb } from "@powerhousedao/reactor-browser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { metricValue } from "../core/app-stats.js";
import { pkhDidFor } from "../core/dids.js";
import {
  BROWSER_KEY,
  failure,
  harnessResolvers,
  insertProfile,
  openHarness,
  registerApp,
  resetHarness,
  USER_NS,
  type Harness,
} from "./harness.js";

const APP = "did:key:zDnaerDaTF5BXEavCrfRZEk316dpbLsfPDZ3WJ5hRTPFU2169";
const APP_2 = "did:key:z6MkjchhfUsD6mmvni8mCdXHw216Xrm9bQe2mBH1P5RDjVJG";
const addr = (n: number) => `0x${"0".repeat(38)}a${n}`;
const user = (n: number) => pkhDidFor(addr(n));
const metric = (key: string, aggregation: string, extra: Record<string, unknown> = {}) => ({
  id: `id-${key}`,
  key,
  label: key.toUpperCase(),
  unit: "u",
  description: null,
  aggregation,
  public: true,
  ...extra,
});

type Stats = {
  appDid: string;
  activeUsers30d: number;
  totalUsers: number;
  updatedAt: string | null;
  metrics: { key: string; value: number; users: number; top: Record<string, unknown>[] }[];
} | null;

let h: Harness;
beforeAll(async () => {
  h = await openHarness();
});
afterAll(async () => {
  await h.root.destroy();
});
beforeEach(async () => {
  await resetHarness(h);
  await registerApp(h, APP);
  await registerApp(h, APP_2);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("appStats", () => {
  it("returns the declared public metrics with their aggregate, users and top five contributors", async () => {
    const r = harnessResolvers(h);
    await r.upsert({
      appDid: APP,
      name: "Vault",
      metrics: [
        metric("notes", "SUM", { unit: "notes" }),
        metric("best", "MAX"),
        metric("avg", "AVG"),
        metric("active", "COUNT_USERS"),
        metric("secret", "SUM", { public: false }),
      ],
    });
    await insertProfile(h, { address: addr(1), documentId: "doc-ada", handle: "ada", displayName: "Ada", avatarRef: `attachment://v1:${"a".repeat(64)}` });
    await insertProfile(h, { address: addr(4), documentId: "doc-a4", userImage: "https://img.example/a4.png" });
    const report = (userDid: string, key: string, value: number) => r.report({ appDid: APP, userDid, metric: key, value });
    for (const [n, v] of [[1, 10], [2, 0], [3, -2], [4, 5], [5, 5], [6, 1]] as const) await report(user(n), "notes", v);
    await report(BROWSER_KEY, "notes", 3);
    await report(user(1), "best", 7);
    await report(user(2), "best", 12);
    await report(user(1), "avg", 1);
    await report(user(2), "avg", 2);
    await report(user(1), "active", 1);
    await report(user(2), "active", 0);
    await report(user(3), "active", 3);
    await report(user(1), "secret", 99);
    await report(user(1), "undeclared", 1);

    const stats = (await r.appStats(APP)) as Stats;
    expect(stats?.metrics.map((m) => [m.key, m.value, m.users])).toEqual([
      ["notes", 22, 7],
      ["best", 12, 2],
      ["avg", 1.5, 2],
      ["active", 2, 3],
    ]);
    expect(stats).toMatchObject({ appDid: APP, totalUsers: 7, activeUsers30d: 7, updatedAt: expect.any(String) });
    const notes = stats?.metrics[0];
    expect(notes).toMatchObject({ label: "NOTES", unit: "notes", description: null, aggregation: "SUM" });
    expect(notes?.top).toEqual([
      { userDid: user(1), value: 10, address: addr(1), handle: "ada", displayName: "Ada", documentId: "doc-ada", hasAvatar: true, userImage: null },
      { userDid: user(4), value: 5, address: addr(4), handle: null, displayName: null, documentId: "doc-a4", hasAvatar: false, userImage: "https://img.example/a4.png" },
      { userDid: user(5), value: 5, address: addr(5), handle: null, displayName: null, documentId: null, hasAvatar: false, userImage: null },
      { userDid: BROWSER_KEY, value: 3, address: null, handle: null, displayName: null, documentId: null, hasAvatar: false, userImage: null },
      { userDid: user(6), value: 1, address: addr(6), handle: null, displayName: null, documentId: null, hasAvatar: false, userImage: null },
    ]);
  });

  it("counts as active only users reported in the last 30 days", async () => {
    let current = new Date("2026-08-01T00:00:00Z");
    const r = harnessResolvers(h, { now: () => current });
    await r.report({ appDid: APP, userDid: user(1), metric: "notes", value: 1 });
    current = new Date("2026-10-09T00:00:00Z");
    await r.report({ appDid: APP, userDid: user(2), metric: "notes", value: 1 });
    expect(await r.appStats(APP)).toMatchObject({ totalUsers: 2, activeUsers30d: 1, updatedAt: "2026-10-09T00:00:00.000Z", metrics: [] });
  });

  it("shows history for a metric declared after its values were reported", async () => {
    const r = harnessResolvers(h);
    await r.report({ appDid: APP, userDid: user(1), metric: "notes", value: 4 });
    expect(((await r.appStats(APP)) as Stats)?.metrics).toEqual([]);
    await r.upsert({ appDid: APP, metrics: [metric("notes", "SUM")] });
    expect(((await r.appStats(APP)) as Stats)?.metrics[0]).toMatchObject({ key: "notes", value: 4, users: 1 });
  });

  it("is null for an app nobody knows, and counts reports of an app without a profile", async () => {
    const r = harnessResolvers(h);
    expect(await r.appStats(APP_2)).toBeNull();
    await r.report({ appDid: APP_2, userDid: user(1), metric: "x", value: 1 });
    expect(await r.appStats(APP_2)).toMatchObject({ appDid: APP_2, totalUsers: 1, activeUsers30d: 1, metrics: [] });
    expect(await r.appStats(APP)).toBeNull();
    await r.upsert({ appDid: APP, metrics: [metric("notes", "MAX")] });
    expect(((await r.appStats(APP)) as Stats)?.metrics).toEqual([
      expect.objectContaining({ key: "notes", value: 0, users: 0, top: [] }),
    ]);
    expect((await failure(r.appStats("not-a-did") as Promise<unknown>)).code).toBe("BAD_USER_INPUT");
  });

  it("still answers, without handles, when the profile read model is unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const relationalDb = {
      queryNamespace: (namespace: string) => {
        if (namespace === USER_NS) throw new Error("read model down");
        return h.root.withSchema(namespace);
      },
    } as unknown as IRelationalDb<unknown>;
    const r = harnessResolvers(h, { relationalDb });
    await r.upsert({ appDid: APP, metrics: [metric("notes", "SUM")] });
    await insertProfile(h, { address: addr(1), documentId: "doc-ada", handle: "ada" });
    await r.report({ appDid: APP, userDid: user(1), metric: "notes", value: 2 });
    const stats = (await r.appStats(APP)) as Stats;
    expect(stats?.metrics[0]?.top[0]).toMatchObject({ address: addr(1), handle: null });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("contributor profile lookup failed"));
  });

  it("picks the value for each aggregation", () => {
    const aggregate = { metric: "m", users: 3, sum: 6, max: 4, avg: 2, positiveUsers: 2, top: [] };
    expect(metricValue("SUM", aggregate)).toBe(6);
    expect(metricValue("MAX", aggregate)).toBe(4);
    expect(metricValue("AVG", aggregate)).toBe(2);
    expect(metricValue("COUNT_USERS", aggregate)).toBe(2);
    expect(metricValue("SUM", undefined)).toBe(0);
  });
});

describe("userStats enrichment", () => {
  it("adds the app and the public metric's label; hides metrics declared private", async () => {
    const r = harnessResolvers(h);
    await r.upsert({
      appDid: APP,
      name: "Vault",
      logo: "https://cdn.example/vault.png",
      metrics: [metric("notes", "SUM", { label: "Notes", unit: "notes" }), metric("secret", "SUM", { public: false })],
    });
    for (const [appDid, key, value] of [
      [APP, "notes", 4],
      [APP, "secret", 1],
      [APP, "raw", 2],
      [APP_2, "x", 1],
    ] as const) {
      await r.report({ appDid, userDid: user(1), metric: key, value });
    }
    const documentId = ((await r.appProfile(APP)) as { documentId: string }).documentId;
    expect(await r.userStats(user(1))).toEqual([
      { appDid: APP, metric: "notes", value: 4, updatedAt: expect.any(String), appName: "Vault", appDocumentId: documentId, appHasLogo: false, appLogo: "https://cdn.example/vault.png", label: "Notes", unit: "notes" },
      { appDid: APP, metric: "raw", value: 2, updatedAt: expect.any(String), appName: "Vault", appDocumentId: documentId, appHasLogo: false, appLogo: "https://cdn.example/vault.png", label: null, unit: null },
      { appDid: APP_2, metric: "x", value: 1, updatedAt: expect.any(String), appName: null, appDocumentId: null, appHasLogo: false, appLogo: null, label: null, unit: null },
    ]);
  });
});
```

In `subgraphs/renown-stats/tests/resolvers.test.ts`, the three full-list `userStats` expectations now see extra fields; loosen exactly those three:

```bash
sed -i 's/^\(\s*\)expect(await userStats(USER)).toEqual(\[$/\1expect(await userStats(USER)).toMatchObject([/' subgraphs/renown-stats/tests/resolvers.test.ts
grep -c "expect(await userStats(USER)).toMatchObject(\[" subgraphs/renown-stats/tests/resolvers.test.ts   # 3
```

(`toEqual([])` lines end in `]);` and are untouched.)

- [ ] **Step 2: Run them to see them fail.** `pnpm exec vitest run subgraphs/renown-stats/tests/app-stats.test.ts 2>&1 | tail -15` → FAIL (`Cannot find module '../core/app-stats.js'`).

- [ ] **Step 3: Implement.**

Create `subgraphs/renown-stats/core/app-stats.ts` with exactly:

```ts
import type { MetricAggregate } from "../store/types.js";
import type { AppMetric } from "./app-metrics-patch.js";

/** Contributors listed per metric on appStats. */
export const TOP_CONTRIBUTORS = 5;
/** A user is active when the app reported anything about them within this window. */
export const ACTIVE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** A metric's headline value under its aggregation; 0 before anyone reported it. */
export function metricValue(
  aggregation: AppMetric["aggregation"],
  aggregate: MetricAggregate | undefined,
): number {
  if (!aggregate) return 0;
  switch (aggregation) {
    case "SUM":
      return aggregate.sum;
    case "MAX":
      return aggregate.max;
    case "AVG":
      return aggregate.avg;
    case "COUNT_USERS":
      return aggregate.positiveUsers;
  }
}
```

In `subgraphs/renown-stats/lookups.ts`, add below the existing imports:

```ts
import { RenownUserProcessor } from "../../processors/renown-user/index.js";
import type { DB as RenownUserDB } from "../../processors/renown-user/schema.js";
```

and append to the end of the file:

```ts

/** What appStats shows of a contributor (Phase 1 read model). */
export interface ContributorProfile {
  documentId: string;
  handle: string | null;
  displayName: string | null;
  hasAvatar: boolean;
  userImage: string | null;
}

/**
 * The Renown profiles behind lowercase wallet addresses, keyed by address.
 * With several profile documents for one address the newest wins (as the
 * profile readers choose). Throws when the read model is unavailable.
 */
export async function contributorProfiles(
  db: ReadModelDb,
  addresses: readonly string[],
): Promise<Map<string, ContributorProfile>> {
  const out = new Map<string, ContributorProfile>();
  if (addresses.length === 0) return out;
  const rows = await RenownUserProcessor.query<RenownUserDB>("renown-user", db)
    .selectFrom("renown_user")
    .select(["document_id", "eth_address", "handle", "display_name", "avatar_ref", "user_image"])
    .where((eb) => eb(eb.fn("LOWER", ["renown_user.eth_address"]), "in", [...addresses]))
    .orderBy("renown_user.created_at", "desc")
    .orderBy("renown_user.document_id", "desc")
    .execute();
  for (const row of rows) {
    const address = row.eth_address?.toLowerCase();
    if (!address || out.has(address)) continue;
    out.set(address, {
      documentId: row.document_id,
      handle: row.handle,
      displayName: row.display_name,
      hasAvatar: row.avatar_ref !== null,
      userImage: row.user_image,
    });
  }
  return out;
}
```

In `subgraphs/renown-stats/resolvers.ts`:

1. Replace `import { hasDelegation, workloadOwner } from "./lookups.js";` with:

```ts
import {
  contributorProfiles,
  hasDelegation,
  workloadOwner,
  type ContributorProfile,
} from "./lookups.js";
```

2. Replace `import { REGISTRAR_HEADER } from "./core/config.js";` with:

```ts
import { ACTIVE_WINDOW_MS, metricValue, TOP_CONTRIBUTORS } from "./core/app-stats.js";
import { REGISTRAR_HEADER } from "./core/config.js";
```

3. Replace:

```ts
interface UserStatOutput {
  appDid: string;
  metric: string;
  value: number;
  updatedAt: string;
}
```

with:

```ts
interface UserStatOutput {
  appDid: string;
  metric: string;
  value: number;
  updatedAt: string;
  /** The app's profile, when it has one. */
  appName: string | null;
  appDocumentId: string | null;
  appHasLogo: boolean;
  appLogo: string | null;
  /** Set when the app declares this metric public. */
  label: string | null;
  unit: string | null;
}

interface MetricContributorOutput {
  userDid: string;
  value: number;
  /** The wallet behind a did:pkh user; null for did:key users. */
  address: string | null;
  handle: string | null;
  displayName: string | null;
  documentId: string | null;
  hasAvatar: boolean;
  userImage: string | null;
}

interface AppMetricStatOutput {
  key: string;
  label: string;
  unit: string | null;
  description: string | null;
  aggregation: AppMetric["aggregation"];
  value: number;
  users: number;
  top: MetricContributorOutput[];
}

interface AppStatsOutput {
  appDid: string;
  activeUsers30d: number;
  totalUsers: number;
  metrics: AppMetricStatOutput[];
  updatedAt: string | null;
}

/** What stats readers need of an app's profile. */
interface AppCard {
  documentId: string;
  name: string | null;
  hasLogo: boolean;
  logo: string | null;
  metrics: AppMetric[];
}
```

4. Directly after the `profileOutput` function (whose end Task 4 left as `      metrics: (state.metrics ?? []).map(toAppMetric),\n    };\n  }`), insert:

```ts

  /** The app's profile as stats readers need it; null without one (or when it cannot be read). */
  async function appCard(index: StatsIndex, appDid: string): Promise<AppCard | null> {
    const entry = await index.appProfile(appDid);
    if (!entry) return null;
    try {
      const doc = await reactorClient.get<RenownAppProfileDocument>(entry.documentId);
      const state = doc.state.global as Partial<RenownAppProfileDocument["state"]["global"]>;
      return {
        documentId: entry.documentId,
        name: state.name ?? null,
        hasLogo: !!state.logoRef,
        logo: state.logo ?? null,
        metrics: (state.metrics ?? []).map(toAppMetric),
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[renown-stats] app profile ${entry.documentId} unreadable (${reason}); stats shown without it`);
      return null;
    }
  }

  /** Renown profiles behind did:pkh user DIDs, by lowercase address. Never throws. */
  async function contributors(userDids: readonly string[]): Promise<Map<string, ContributorProfile>> {
    const addresses = [...new Set(userDids.map(addressOf).filter((a): a is string => a !== null))];
    if (addresses.length === 0) return new Map();
    try {
      return await contributorProfiles(relationalDb, addresses);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[renown-stats] contributor profile lookup failed (${reason}); showing addresses`);
      return new Map();
    }
  }

  function contributorOutput(
    top: { userDid: string; value: number },
    profiles: Map<string, ContributorProfile>,
  ): MetricContributorOutput {
    const address = addressOf(top.userDid);
    const profile = address ? profiles.get(address) : undefined;
    return {
      userDid: top.userDid,
      value: top.value,
      address,
      handle: profile?.handle ?? null,
      displayName: profile?.displayName ?? null,
      documentId: profile?.documentId ?? null,
      hasAvatar: profile?.hasAvatar ?? false,
      userImage: profile?.userImage ?? null,
    };
  }
```

5. Replace the whole `userStats` resolver (from `      userStats: async (` through its closing `      },`, unchanged since before Phase 2) with:

```ts
      userStats: async (
        _: unknown,
        args: { userDid: string },
      ): Promise<UserStatOutput[]> => {
        const userDid = canonicalUserDid(args.userDid);
        if (userDid === null)
          throw invalidRequest(
            "userDid must be a did:pkh:eip155 or did:key DID",
          );
        const index = requireIndex();
        const documentId = await index.userStatsDocument(userDid);
        if (!documentId) return [];
        const doc =
          await reactorClient.get<RenownUserStatsDocument>(documentId);
        const cards = new Map<string, Promise<AppCard | null>>();
        const cardOf = (appDid: string): Promise<AppCard | null> => {
          let card = cards.get(appDid);
          if (!card) {
            card = appCard(index, appDid);
            cards.set(appDid, card);
          }
          return card;
        };
        const out: UserStatOutput[] = [];
        for (const { appDid, metric, value, updatedAt } of doc.state.global.stats) {
          const card = await cardOf(appDid);
          const declared = card?.metrics.find((m) => m.key === metric);
          // A metric its publisher declared private is shown nowhere.
          if (declared && !declared.public) continue;
          out.push({
            appDid,
            metric,
            value,
            updatedAt,
            appName: card?.name ?? null,
            appDocumentId: card?.documentId ?? null,
            appHasLogo: card?.hasLogo ?? false,
            appLogo: card?.logo ?? null,
            label: declared?.label ?? null,
            unit: declared?.unit ?? null,
          });
        }
        return out;
      },
```

6. Replace the end of the `appProfiles` resolver (Phase 2 text):

```ts
              ? encodeCursor({ createdAt: last.createdAt, appDid: last.appDid })
              : null,
        };
      },
    },
```

with:

```ts
              ? encodeCursor({ createdAt: last.createdAt, appDid: last.appDid })
              : null,
        };
      },

      appStats: async (
        _: unknown,
        args: { appDid: string },
      ): Promise<AppStatsOutput | null> => {
        const appDid = canonicalAppDid(args.appDid);
        if (appDid === null)
          throw invalidRequest("appDid must be a did:key DID");
        const index = requireIndex();
        const since = new Date(now().getTime() - ACTIVE_WINDOW_MS);
        const [card, activity] = await Promise.all([
          appCard(index, appDid),
          index.appActivity(appDid, since),
        ]);
        if (!card && activity.totalUsers === 0) return null;
        // Only metrics the publisher declared public. Undeclared values stay
        // stored (declaring later shows their history) but are never exposed.
        const declared = (card?.metrics ?? []).filter((m) => m.public);
        const aggregates = await index.metricAggregates(
          appDid,
          declared.map((m) => m.key),
          TOP_CONTRIBUTORS,
        );
        const byMetric = new Map(aggregates.map((a) => [a.metric, a]));
        const profiles = await contributors(
          aggregates.flatMap((a) => a.top.map((t) => t.userDid)),
        );
        return {
          appDid,
          activeUsers30d: activity.activeUsers,
          totalUsers: activity.totalUsers,
          updatedAt: activity.updatedAt?.toISOString() ?? null,
          metrics: declared.map((m) => {
            const aggregate = byMetric.get(m.key);
            return {
              key: m.key,
              label: m.label,
              unit: m.unit,
              description: m.description,
              aggregation: m.aggregation,
              value: metricValue(m.aggregation, aggregate),
              users: aggregate?.users ?? 0,
              top: (aggregate?.top ?? []).map((t) => contributorOutput(t, profiles)),
            };
          }),
        };
      },
    },
```

In `subgraphs/renown-stats/schema.ts`:

1. Replace:

```ts
  type UserStat {
    appDid: String!
    metric: String!
    value: Float!
    updatedAt: String!
  }
```

with:

```ts
  type UserStat {
    appDid: String!
    metric: String!
    value: Float!
    updatedAt: String!
    "The app's profile name, when it has a profile."
    appName: String
    "The app's profile document: its logo is <renown>/media/<appDocumentId>/logo when appHasLogo."
    appDocumentId: String
    appHasLogo: Boolean!
    "Legacy logo URL of the app (https or raster data URL)."
    appLogo: String
    "Set when the app declares this metric public; null for undeclared metrics."
    label: String
    unit: String
  }

  type MetricContributor {
    userDid: String!
    value: Float!
    "The wallet behind a did:pkh user; null for did:key users."
    address: String
    handle: String
    displayName: String
    "The contributor's Renown profile document (avatar at <renown>/media/<documentId>/avatar when hasAvatar)."
    documentId: String
    hasAvatar: Boolean!
    userImage: String
  }

  type AppMetricStat {
    key: String!
    label: String!
    unit: String
    description: String
    aggregation: RenownMetricAggregation!
    "SUM, MAX or AVG of users' current values, or (COUNT_USERS) users with a value above zero."
    value: Float!
    "Users with a value."
    users: Int!
    "Top 5 by value."
    top: [MetricContributor!]!
  }

  type AppStats {
    appDid: String!
    "Users the app reported anything about in the last 30 days."
    activeUsers30d: Int!
    totalUsers: Int!
    "Declared public metrics, in the publisher's order."
    metrics: [AppMetricStat!]!
    "ISO time of the latest report, or null."
    updatedAt: String
  }
```

2. Replace:

```ts
    appProfiles(limit: Int, after: String): AppProfilePage!
  }
```

with:

```ts
    appProfiles(limit: Int, after: String): AppProfilePage!
    "Public stats of an app; null when it has neither a profile nor any reported value."
    appStats(appDid: String!): AppStats
  }
```

Append to `subgraphs/renown-stats/README.md`:

```markdown

### Reading stats

`appStats(appDid)` (public) derives, per query, for each **declared public** metric: SUM/MAX/AVG over users' current values or COUNT_USERS (users with a value > 0), `users` with a value, and the top 5 contributors (value desc, earlier report first) with their Renown handle, display name and avatar from the `renown-user` read model (missing or unavailable read model → address only). `activeUsers30d` counts users with any stat for the app reported in the last 30 days, `totalUsers` all of them. `null` when the app has neither a profile nor any value.

`userStats(userDid)` now carries the app's `appName`, `appDocumentId`, `appHasLogo`, `appLogo` and, for metrics the app declares public, `label` and `unit`. Metrics declared private are omitted; undeclared ones are returned without a label.
```

- [ ] **Step 4: Run everything.** `pnpm exec vitest run subgraphs/renown-stats 2>&1 | tail -20` → PASS. `pnpm exec vitest run --coverage 2>&1 | grep -E "ERROR|Threshold|All files"` → thresholds pass. `pnpm tsc 2>&1 | tail -5`, `pnpm lint 2>&1 | tail -5` → no errors.

- [ ] **Step 5: Commit.**

```bash
git add subgraphs/renown-stats/core/app-stats.ts subgraphs/renown-stats/lookups.ts subgraphs/renown-stats/resolvers.ts subgraphs/renown-stats/schema.ts subgraphs/renown-stats/README.md subgraphs/renown-stats/tests/app-stats.test.ts subgraphs/renown-stats/tests/resolvers.test.ts
git commit -m "feat(renown-stats): public appStats with top contributors; userStats names apps and metrics"
```

## Part B — vetra-cloud-package (relay, helper, proof)

Precondition: Phase 2 Task 5 is committed in `/home/f/projects/vetra-cloud-package-profiles` on `feat/identity-hub-profiles` (Ruling 9). `cd /home/f/projects/vetra-cloud-package-profiles && git switch feat/identity-hub-profiles && git log --oneline -1`. If Phase 2 has already been merged to `main`, first bring the branch up to date: `git fetch origin && git merge --ff-only origin/main 2>/dev/null || git merge --no-edit origin/main`.

### Task 6: Relay metric definitions through `updateAppProfile`

**Files:**
- Modify: `subgraphs/vetra-licensing/renown-profile.ts`, `subgraphs/vetra-licensing/publisher-schema.ts`, `docs/superpowers/specs/2026-10-08-licensing-api-contract.md`
- Test: `subgraphs/vetra-licensing/__tests__/renown-profile.test.ts` (append), `subgraphs/vetra-licensing/__tests__/app-profile-relay.test.ts` (append), existing `contract.test.ts`

**Interfaces:**
- Consumes: Task 4's `upsertAppProfile(…, metrics: [AppMetricInput!])`; Phase 2 Task 5 (`createRenownProfileRelay`, `AppProfileWrite`, `PROFILE_WRITE_KEYS`, `updateAppProfile` resolver forwarding `a.input`).
- Produces:
  - `renown-profile.ts`: `type MetricAggregation = "SUM" | "MAX" | "AVG" | "COUNT_USERS"`; `interface AppProfileMetricInput { id: string; key: string; label: string; unit?: string | null; description?: string | null; aggregation: MetricAggregation; public: boolean }`; `AppProfileWrite.metrics?: AppProfileMetricInput[] | null`; `PROFILE_WRITE_KEYS` includes `"metrics"`.
  - GraphQL on Vetra's switchboard: `enum PublisherMetricAggregation { SUM MAX AVG COUNT_USERS }`; `input PublisherAppMetricInput { id: String!, key: String!, label: String!, unit: String, description: String, aggregation: PublisherMetricAggregation!, public: Boolean! }`; `UpdateAppProfileInput.metrics: [PublisherAppMetricInput!]`. Renown's refusals arrive as `INVALID_INPUT` with `extensions.field = "metrics"` (Phase 2 mapping).

- [ ] **Step 1: Write the failing tests (contract first).**

In `docs/superpowers/specs/2026-10-08-licensing-api-contract.md` (§ vetraPublisher, the block Phase 2 Task 5 added) replace:

```graphql
  links: [PublisherAppLinkInput!]
}
```

with:

```graphql
  links: [PublisherAppLinkInput!]
  metrics: [PublisherAppMetricInput!]
}
enum PublisherMetricAggregation { SUM MAX AVG COUNT_USERS }
"A publisher-defined metric: key is what environments report; the rest is how Renown shows it."
input PublisherAppMetricInput {
  id: String!  key: String!  label: String!
  unit: String  description: String
  aggregation: PublisherMetricAggregation!  public: Boolean!
}
```

and append to that section's "Error codes" paragraph: `` `updateAppProfile.metrics` replaces the whole list (`[]` clears); Renown refuses an invalid list with `INVALID_INPUT`, `extensions.field = "metrics"`. ``

Append to `subgraphs/vetra-licensing/__tests__/renown-profile.test.ts`:

```ts

describe("metric definitions (identity hub phase 3)", () => {
  it("forwards the metric list as Renown's AppMetricInput", async () => {
    const fetch = answering(200, { data: { upsertAppProfile: true } });
    const relay = createRenownProfileRelay({ statsUrl: URL_, registrationToken: "reg", fetch: fetch as never })!;
    const metrics = [
      { id: "m1", key: "notes", label: "Notes", unit: "notes", description: null, aggregation: "SUM" as const, public: true },
    ];
    await relay.upsert(DID, "user-bearer", { metrics });
    const [, init] = fetch.mock.calls[0]!;
    const body = JSON.parse(init.body as string) as { query: string; variables: Record<string, unknown> };
    expect(body.query).toContain("$metrics: [AppMetricInput!]");
    expect(body.query).toContain("metrics: $metrics");
    expect(body.variables).toEqual({ appDid: DID, metrics });
  });
});
```

Append to `subgraphs/vetra-licensing/__tests__/app-profile-relay.test.ts`:

```ts

describe("vetraPublisher.updateAppProfile metrics", () => {
  it("passes the metric list to Renown with the owner's bearer", async () => {
    const fake = relay();
    const input = {
      appId: APP,
      metrics: [{ id: "m1", key: "notes", label: "Notes", unit: null, description: null, aggregation: "SUM", public: true }],
    };
    expect(await update(h.build({ renownProfile: fake }), input, withBearer(OWNER))).toBe(true);
    expect(fake.upsert).toHaveBeenCalledWith(DID, "user-bearer", input);
  });

  it("shows Renown's refusal of a metric list on the metrics field", async () => {
    const fake = relay(async () => {
      throw new RenownProfileError("INVALID_INPUT", 'Metric key "notes" is declared twice', "metrics");
    });
    const error = (await update(h.build({ renownProfile: fake }), { appId: APP, metrics: [] }, withBearer(OWNER)).catch(
      (e: unknown) => e,
    )) as GraphQLError;
    expect(error.extensions).toEqual({ code: "INVALID_INPUT", field: "metrics" });
  });
});
```

- [ ] **Step 2: Run them to see them fail.** `pnpm exec vitest run subgraphs/vetra-licensing/__tests__/contract.test.ts subgraphs/vetra-licensing/__tests__/renown-profile.test.ts 2>&1 | tail -20` → FAIL (the contract declares `metrics`/`PublisherAppMetricInput` the schema lacks; the mutation has no `$metrics`).

- [ ] **Step 3: Implement.**

In `subgraphs/vetra-licensing/renown-profile.ts`:

1. Replace:

```ts
/** What a publisher may change. Absent or null: unchanged; "": clear; links: the whole list. */
```

with:

```ts
export type MetricAggregation = "SUM" | "MAX" | "AVG" | "COUNT_USERS";

/** A publisher-defined metric (Renown's AppMetricInput). */
export interface AppProfileMetricInput {
  id: string;
  key: string;
  label: string;
  unit?: string | null;
  description?: string | null;
  aggregation: MetricAggregation;
  public: boolean;
}

/** What a publisher may change. Absent or null: unchanged; "": clear; links and metrics: the whole list. */
```

2. Replace:

```ts
  links?: AppProfileLinkInput[] | null;
}
```

with:

```ts
  links?: AppProfileLinkInput[] | null;
  metrics?: AppProfileMetricInput[] | null;
}
```

3. Replace:

```ts
  "links",
] as const;
```

with:

```ts
  "links",
  "metrics",
] as const;
```

4. Replace the whole `const UPSERT = …;` statement with:

```ts
const UPSERT = `mutation UpsertAppProfile($appDid: String!, $name: String, $tagline: String, $website: String, $description: String, $category: String, $logoRef: String, $coverRef: String, $links: [AppProfileLinkInput!], $metrics: [AppMetricInput!]) {
  upsertAppProfile(appDid: $appDid, name: $name, tagline: $tagline, website: $website, description: $description, category: $category, logoRef: $logoRef, coverRef: $coverRef, links: $links, metrics: $metrics)
}`;
```

In `subgraphs/vetra-licensing/publisher-schema.ts` replace (Phase 2 text):

```ts
    links: [PublisherAppLinkInput!]
  }
```

with:

```ts
    links: [PublisherAppLinkInput!]
    "Publisher-defined metrics, the whole list (at most 16); [] clears."
    metrics: [PublisherAppMetricInput!]
  }

  enum PublisherMetricAggregation {
    SUM
    MAX
    AVG
    COUNT_USERS
  }

  "A publisher-defined metric: key is what environments report; the rest is how Renown shows it."
  input PublisherAppMetricInput {
    id: String!
    key: String!
    label: String!
    unit: String
    description: String
    aggregation: PublisherMetricAggregation!
    public: Boolean!
  }
```

- [ ] **Step 4: Run tests, types, lint.** `pnpm exec vitest run subgraphs/vetra-licensing 2>&1 | tail -20` → PASS (incl. `contract.test.ts`, `schema-composition.test.ts`). `pnpm tsc 2>&1 | tail -5`, `pnpm lint 2>&1 | tail -5` → no errors.

- [ ] **Step 5: Commit.**

```bash
git add subgraphs/vetra-licensing/renown-profile.ts subgraphs/vetra-licensing/publisher-schema.ts docs/superpowers/specs/2026-10-08-licensing-api-contract.md subgraphs/vetra-licensing/__tests__/renown-profile.test.ts subgraphs/vetra-licensing/__tests__/app-profile-relay.test.ts
git commit -m "feat(licensing): relay app metric definitions to Renown"
```

### Task 7: The stats relay finds the studio app's Renown identity

**Files:**
- Create: `subgraphs/vetra-licensing/app-identity.ts`
- Modify: `subgraphs/vetra-licensing/index.ts`
- Test: `subgraphs/vetra-licensing/__tests__/app-identity.test.ts`

**Interfaces:**
- Consumes: `AppReads.app(id): Promise<AppDocView | null>` (`app-reads.ts`; `identityDid`, `tampered`, `unverified`), `STUDIO_APP_ID` (`studio-app.ts`), `RelayDeps.appIdentity` (`reporting.ts`).
- Produces: `interface AppIdentity { identityDid: string | null; status: string }`; `createAppIdentityLookup(deps: { row(appId: string): Promise<{ identity_did: string | null; status: string } | null>; apps: Pick<AppReads, "app"> }): (appId: string) => Promise<AppIdentity | null>` — the apps row when there is one; for `STUDIO_APP_ID` without a row, the studio document's `identityDid` as `ACTIVE` when the document is neither tampered nor unverified; otherwise null.

- [ ] **Step 1: Write the failing test.**

Create `subgraphs/vetra-licensing/__tests__/app-identity.test.ts` with exactly:

```ts
import { describe, expect, it, vi } from "vitest";
import { createAppIdentityLookup } from "../app-identity.js";
import type { AppDocView } from "../app-reads.js";
import { STUDIO_APP_ID } from "../studio-app.js";

const DID = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";
const APP = "7c1d2e3f-5d0e-4e3e-9a55-1c3b9b8f2a44";

function studioDoc(extra: Partial<AppDocView> = {}): AppDocView {
  return {
    id: STUDIO_APP_ID,
    name: "Vetra Studio",
    slug: "vetra-studio",
    owner: null,
    status: "ACTIVE",
    identityDid: DID,
    productionEnvironmentId: null,
    templates: [],
    terms: [],
    artifacts: [],
    tampered: false,
    tamperReason: null,
    licensingStateHash: "hash",
    unverified: false,
    ...extra,
  };
}

function lookup(row: { identity_did: string | null; status: string } | null, doc: AppDocView | null) {
  const apps = { app: vi.fn(async () => doc) };
  return { apps, identityOf: createAppIdentityLookup({ row: async () => row, apps }) };
}

describe("createAppIdentityLookup", () => {
  it("uses the apps row whenever there is one", async () => {
    const { apps, identityOf } = lookup({ identity_did: "did:key:zRow", status: "DISCONNECTED" }, studioDoc());
    expect(await identityOf(STUDIO_APP_ID)).toEqual({ identityDid: "did:key:zRow", status: "DISCONNECTED" });
    expect(await identityOf(APP)).toEqual({ identityDid: "did:key:zRow", status: "DISCONNECTED" });
    expect(apps.app).not.toHaveBeenCalled();
  });

  it("knows no other document-only app", async () => {
    const { apps, identityOf } = lookup(null, studioDoc());
    expect(await identityOf(APP)).toBeNull();
    expect(apps.app).not.toHaveBeenCalled();
  });

  it("reads the studio app's identity from its ledger-checked document", async () => {
    expect(await lookup(null, studioDoc()).identityOf(STUDIO_APP_ID)).toEqual({ identityDid: DID, status: "ACTIVE" });
  });

  it.each([
    ["a tampered document", studioDoc({ tampered: true, tamperReason: "parent" })],
    ["an unverified document", studioDoc({ unverified: true })],
    ["a document without an identity", studioDoc({ identityDid: null })],
    ["no document", null],
  ])("refuses the studio app with %s", async (_, doc) => {
    expect(await lookup(null, doc).identityOf(STUDIO_APP_ID)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail.** `pnpm exec vitest run subgraphs/vetra-licensing/__tests__/app-identity.test.ts 2>&1 | tail -10` → FAIL (`Cannot find module '../app-identity.js'`).

- [ ] **Step 3: Implement.**

Create `subgraphs/vetra-licensing/app-identity.ts` with exactly:

```ts
import type { AppReads } from "./app-reads.js";
import { STUDIO_APP_ID } from "./studio-app.js";

/** The Renown workload identity an app reports stats as, and the app's status. */
export interface AppIdentity {
  identityDid: string | null;
  status: string;
}

/**
 * The relay's app identity (reporting.ts RelayDeps.appIdentity).
 *
 * An app with an `apps` row: the row, never its document. The studio app
 * (STUDIO_APP_ID) is licensing-only and has no row; its identity comes from
 * its document, but only when the ledger vouches for it (neither tampered nor
 * unverified). Renown still refuses the report unless that DID is a
 * registered workload identity whose owner holds a live delegation, so the
 * document can at most name an identity Renown already trusts for the studio.
 */
export function createAppIdentityLookup(deps: {
  row(appId: string): Promise<{ identity_did: string | null; status: string } | null>;
  apps: Pick<AppReads, "app">;
}): (appId: string) => Promise<AppIdentity | null> {
  return async (appId) => {
    const row = await deps.row(appId);
    if (row) return { identityDid: row.identity_did, status: row.status };
    if (appId !== STUDIO_APP_ID) return null;
    const doc = await deps.apps.app(STUDIO_APP_ID);
    if (!doc || doc.tampered || doc.unverified || !doc.identityDid) return null;
    return { identityDid: doc.identityDid, status: "ACTIVE" };
  };
}
```

In `subgraphs/vetra-licensing/index.ts`:
1. Add `import { createAppIdentityLookup } from "./app-identity.js";` below `import { createRenownProfileRelay } from "./renown-profile.js";`.
2. In the `relayDeps` object, replace:

```ts
      // The app DID comes from the apps row, never the app document.
      appIdentity: async (appId) => {
        const row = await appsDb
          .selectFrom("apps")
          .select(["identity_did", "status"])
          .where("id", "=", appId)
          .executeTakeFirst();
        return row ? { identityDid: row.identity_did, status: row.status } : null;
      },
```

with:

```ts
      // The apps row; the studio app (no row) from its ledger-checked document.
      appIdentity: createAppIdentityLookup({
        row: async (appId) =>
          (await appsDb
            .selectFrom("apps")
            .select(["identity_did", "status"])
            .where("id", "=", appId)
            .executeTakeFirst()) ?? null,
        apps: appReads,
      }),
```

- [ ] **Step 4: Run tests, types, lint.** `pnpm exec vitest run subgraphs/vetra-licensing 2>&1 | tail -15` → PASS. `pnpm tsc 2>&1 | tail -5`, `pnpm lint 2>&1 | tail -5` → no errors.

- [ ] **Step 5: Commit.**

```bash
git add subgraphs/vetra-licensing/app-identity.ts subgraphs/vetra-licensing/index.ts subgraphs/vetra-licensing/__tests__/app-identity.test.ts
git commit -m "fix(licensing): relay studio stats as the studio app's Renown identity"
```

### Task 8: `reportUserStat` helper for package authors, and the staging proof script

**Files:**
- Create: `shared/report-user-stat.ts`, `scripts/smoke/app-stats-proof.mts`
- Test: `shared/report-user-stat.test.ts`

**Interfaces:**
- Consumes: the Vetra reporting contract (Global Constraints); Task 5's `appStats`/`userStats`; Tasks 9–10's page markers (`data-metric`, `data-value` on stat tiles; `data-app-did` on profile stat groups).
- Produces:
  - `shared/report-user-stat.ts` (dependency-free; vetra.io shows it verbatim — keep it free of template literals): `reportUserStat(user: string, metric: string, value: number, options?: ReportUserStatOptions): Promise<boolean>`; `interface ReportUserStatOptions { env?: Record<string, string | undefined>; fetch?: typeof fetch; timeoutMs?: number }`; `class ReportUserStatError extends Error { readonly code: string }` (codes `INVALID_INPUT`, `UNAUTHENTICATED`, other Vetra codes, `NETWORK`, `HTTP_<status>`).
  - `scripts/smoke/app-stats-proof.mts` CLI: `--namespace --deployment [--container] --app-did --user --metric [--value] [--renown-switchboard] [--renown-web] [--timeout]`; exit 0 = proven.

- [ ] **Step 1: Write the failing test.**

Create `shared/report-user-stat.test.ts` with exactly:

```ts
import { describe, expect, it, vi } from "vitest";
import { reportUserStat, ReportUserStatError } from "./report-user-stat.js";

const ENV = {
  VETRA_LICENSING_URL: "https://switchboard.staging.vetra.io/graphql/vetra-licensing",
  VETRA_REPORTING_TOKEN: "env-token",
};
const USER = "did:pkh:eip155:1:0x1111111111111111111111111111111111111111";

function answering(status: number, body: unknown) {
  return vi.fn(async (_url: string, _init: RequestInit) =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
  );
}

async function refusal(promise: Promise<unknown>): Promise<ReportUserStatError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ReportUserStatError);
  return error as ReportUserStatError;
}

describe("reportUserStat (package authors' helper)", () => {
  it("sends nothing outside a Vetra environment", async () => {
    const fetch = answering(200, {});
    expect(await reportUserStat(USER, "notes", 1, { env: {}, fetch: fetch as never })).toBe(false);
    expect(
      await reportUserStat(USER, "notes", 1, {
        env: { VETRA_LICENSING_URL: ENV.VETRA_LICENSING_URL, VETRA_REPORTING_TOKEN: " " },
        fetch: fetch as never,
      }),
    ).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("posts the current value with the reporting token header", async () => {
    const fetch = answering(200, { data: { vetraLicensing: { reportUserStat: true } } });
    expect(await reportUserStat(USER, "notes", 0, { env: ENV, fetch: fetch as never })).toBe(true);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(ENV.VETRA_LICENSING_URL);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/json", "x-vetra-reporting-token": "env-token" });
    const body = JSON.parse(init.body as string) as { query: string; variables: unknown };
    expect(body.query).toContain("vetraLicensing { reportUserStat(user: $user, metric: $metric, value: $value) }");
    expect(body.variables).toEqual({ user: USER, metric: "notes", value: 0 });
  });

  it("resolves false when Vetra does not relay the report", async () => {
    const fetch = answering(200, { data: { vetraLicensing: { reportUserStat: false } } });
    expect(await reportUserStat(USER, "notes", 3, { env: ENV, fetch: fetch as never })).toBe(false);
  });

  it("rejects an invalid metric or value without sending", async () => {
    const fetch = answering(200, {});
    expect((await refusal(reportUserStat(USER, "9lives", 1, { env: ENV, fetch: fetch as never }))).code).toBe("INVALID_INPUT");
    expect((await refusal(reportUserStat(USER, "notes", Number.NaN, { env: ENV, fetch: fetch as never }))).code).toBe(
      "INVALID_INPUT",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("surfaces Vetra's error code, HTTP failures and network failures", async () => {
    const unknownToken = answering(200, {
      errors: [{ message: "unknown reporting token", extensions: { code: "UNAUTHENTICATED" } }],
    });
    const error = await refusal(reportUserStat(USER, "notes", 1, { env: ENV, fetch: unknownToken as never }));
    expect(error).toMatchObject({ code: "UNAUTHENTICATED", message: "unknown reporting token" });
    const noCode = answering(200, { errors: [{}] });
    expect((await refusal(reportUserStat(USER, "notes", 1, { env: ENV, fetch: noCode as never }))).code).toBe("ERROR");
    const gateway = answering(502, "bad gateway");
    expect((await refusal(reportUserStat(USER, "notes", 1, { env: ENV, fetch: gateway as never }))).code).toBe("HTTP_502");
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect((await refusal(reportUserStat(USER, "notes", 1, { env: ENV, fetch: down as never }))).code).toBe("NETWORK");
  });
});
```

- [ ] **Step 2: Run it to see it fail.** `pnpm exec vitest run shared/report-user-stat.test.ts 2>&1 | tail -10` → FAIL (`Cannot find module './report-user-stat.js'`).

- [ ] **Step 3: Implement the helper.** Create `shared/report-user-stat.ts` with exactly:

```ts
// Report a user's current value of an app metric to Vetra, which relays it
// to Renown: the app's page (renown.id/app/<app DID>) and the user's profile.
//
// Vetra gives each licensed environment two variables:
//   VETRA_REPORTING_TOKEN  this environment's reporting token (a secret)
//   VETRA_LICENSING_URL    the endpoint to call
// Without them (local development) nothing is sent and the result is false.
//
// Dependency-free: copy this file into your package.
// Docs: https://vetra.io/docs/app-stats

const METRIC = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;
const MUTATION =
  "mutation ReportUserStat($user: String!, $metric: String!, $value: Float!) " +
  "{ vetraLicensing { reportUserStat(user: $user, metric: $metric, value: $value) } }";

export class ReportUserStatError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ReportUserStatError";
    this.code = code;
  }
}

export interface ReportUserStatOptions {
  /** Where the two variables are read from (default: process.env). */
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  /** Default 10000 ms. */
  timeoutMs?: number;
}

type Answer = {
  data?: { vetraLicensing?: { reportUserStat?: unknown } | null } | null;
  errors?: { message?: string; extensions?: { code?: unknown } }[];
} | null;

/**
 * Sends the user's CURRENT value of `metric` (not a delta: the newest report
 * wins). Resolves true when Vetra queued it for Renown, false when nothing was
 * sent (not on Vetra) or Vetra did not relay it (the user is not this
 * environment's licence holder, the app has no usable Renown identity, or
 * Renown refused the app recently). Throws ReportUserStatError for an invalid
 * metric or value (INVALID_INPUT), an unknown token (UNAUTHENTICATED), or when
 * Vetra cannot be reached (NETWORK, HTTP_<status>).
 */
export async function reportUserStat(
  user: string,
  metric: string,
  value: number,
  options: ReportUserStatOptions = {},
): Promise<boolean> {
  const env = options.env ?? process.env;
  const url = env.VETRA_LICENSING_URL?.trim();
  const token = env.VETRA_REPORTING_TOKEN?.trim();
  if (!url || !token) return false;
  if (!METRIC.test(metric)) {
    throw new ReportUserStatError("INVALID_INPUT", "metric must match " + METRIC.source);
  }
  if (!Number.isFinite(value)) {
    throw new ReportUserStatError("INVALID_INPUT", "value must be a finite number");
  }
  let res: Response;
  try {
    res = await (options.fetch ?? fetch)(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-vetra-reporting-token": token },
      body: JSON.stringify({ query: MUTATION, variables: { user, metric, value } }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 10000),
    });
  } catch (error) {
    throw new ReportUserStatError("NETWORK", error instanceof Error ? error.message : "request failed");
  }
  const answer = (await res.json().catch(() => null)) as Answer;
  const error = answer?.errors?.[0];
  if (error) {
    const code = typeof error.extensions?.code === "string" ? error.extensions.code : "ERROR";
    throw new ReportUserStatError(code, error.message ?? "reportUserStat failed");
  }
  if (!res.ok) {
    throw new ReportUserStatError("HTTP_" + String(res.status), "Vetra answered " + String(res.status));
  }
  return answer?.data?.vetraLicensing?.reportUserStat === true;
}
```

- [ ] **Step 4: Run it.** `pnpm exec vitest run shared/report-user-stat.test.ts 2>&1 | tail -10` → PASS.

- [ ] **Step 5: Write the proof script.** Create `scripts/smoke/app-stats-proof.mts` with exactly:

```ts
/**
 * Identity hub phase 3: proves the app-stats path end to end on a live stack.
 *
 *   environment pod (VETRA_REPORTING_TOKEN, VETRA_LICENSING_URL)
 *     -> Vetra vetraLicensing.reportUserStat (x-vetra-reporting-token)
 *     -> Vetra's relay -> Renown renown-stats reportUserStat
 *     -> userStats(user), appStats(appDid), renown.id /app/<did>, the user's profile
 *
 * The report is sent from INSIDE the environment's switchboard pod with the
 * pod's own variables, so it also proves they reached the environment.
 * Nothing secret is printed (presence checks print set/MISSING only).
 *
 * Usage (staging defaults):
 *   node --experimental-strip-types scripts/smoke/app-stats-proof.mts \
 *     --namespace <env namespace> --deployment <env switchboard deployment> \
 *     --app-did did:key:z... --user did:pkh:eip155:1:0x... --metric notes \
 *     [--container switchboard] [--value 42] \
 *     [--renown-switchboard https://switchboard.renown-staging.vetra.io] \
 *     [--renown-web https://renown-staging.vetra.io] [--timeout 180]
 *
 * The metric must be declared public in the app's Profile tab (vetra.io).
 * Exit 0 when every check passes; 1 at the first failing check.
 */
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    namespace: { type: "string" },
    deployment: { type: "string" },
    container: { type: "string" },
    "app-did": { type: "string" },
    user: { type: "string" },
    metric: { type: "string" },
    value: { type: "string" },
    "renown-switchboard": { type: "string", default: "https://switchboard.renown-staging.vetra.io" },
    "renown-web": { type: "string", default: "https://renown-staging.vetra.io" },
    timeout: { type: "string", default: "180" },
  },
});

function fail(message: string): never {
  console.error(`FAIL ${message}`);
  process.exit(1);
}

function ok(message: string): void {
  console.log(`ok   ${message}`);
}

function need(name: "namespace" | "deployment" | "app-did" | "user" | "metric"): string {
  const value = args[name];
  if (typeof value !== "string" || value.trim() === "") fail(`--${name} is required`);
  return value.trim();
}

const namespace = need("namespace");
const deployment = need("deployment");
const appDid = need("app-did");
const user = need("user");
const metric = need("metric");
// A fresh value per run, so a stale page can never pass for this run.
const value = args.value ? Number(args.value) : (Date.now() % 100_000) + 1;
if (!Number.isFinite(value)) fail("--value must be a number");
const statsUrl = `${String(args["renown-switchboard"]).replace(/\/+$/, "")}/graphql/renown-stats`;
const web = String(args["renown-web"]).replace(/\/+$/, "");
const deadline = Date.now() + Number(args.timeout) * 1000;
const address = /^did:pkh:eip155:\d+:(0x[0-9a-fA-F]{40})$/.exec(user)?.[1]?.toLowerCase() ?? null;

function inPod(command: string[]): string {
  const container = args.container ? ["-c", args.container] : [];
  return execFileSync("kubectl", ["-n", namespace, "exec", `deploy/${deployment}`, ...container, "--", ...command], {
    encoding: "utf8",
  });
}

// 1. The environment holds both variables (values never leave the pod).
const presence = inPod([
  "sh",
  "-c",
  'for v in VETRA_REPORTING_TOKEN VETRA_LICENSING_URL; do if [ -n "$(printenv $v)" ]; then echo "$v set"; else echo "$v MISSING"; fi; done',
]);
if (presence.includes("MISSING")) fail(`the environment lacks its reporting variables:\n${presence.trim()}`);
ok("the environment has VETRA_REPORTING_TOKEN and VETRA_LICENSING_URL");

// 2. Report from inside the pod, exactly as package code there would.
const REPORT = [
  "const [user, metric, value] = process.argv.slice(-3);",
  "fetch(process.env.VETRA_LICENSING_URL, {",
  '  method: "POST",',
  '  headers: { "content-type": "application/json", "x-vetra-reporting-token": process.env.VETRA_REPORTING_TOKEN },',
  "  body: JSON.stringify({",
  '    query: "mutation R($u: String!, $m: String!, $v: Float!) { vetraLicensing { reportUserStat(user: $u, metric: $m, value: $v) } }",',
  "    variables: { u: user, m: metric, v: Number(value) },",
  "  }),",
  "})",
  "  .then(async (r) => console.log(JSON.stringify({ status: r.status, body: await r.json().catch(() => null) })))",
  "  .catch((e) => console.log(JSON.stringify({ error: String(e) })));",
].join("\n");
const answerLine = inPod(["node", "-e", REPORT, user, metric, String(value)]).trim().split("\n").at(-1) ?? "{}";
const answer = JSON.parse(answerLine) as {
  status?: number;
  error?: string;
  body?: { data?: { vetraLicensing?: { reportUserStat?: boolean } }; errors?: unknown } | null;
};
if (answer.body?.data?.vetraLicensing?.reportUserStat !== true) {
  fail(`Vetra did not queue the report: ${answerLine} (see the Task 15 decision table)`);
}
ok(`Vetra queued ${metric}=${value} for ${user}`);

async function stats<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(statsUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await res.json()) as { data?: T; errors?: { message?: string }[] };
  if (body.errors?.length || !body.data) throw new Error(body.errors?.[0]?.message ?? `HTTP ${res.status}`);
  return body.data;
}

async function until<T>(what: string, probe: () => Promise<T | null>): Promise<T> {
  let last = "not yet";
  for (;;) {
    try {
      const result = await probe();
      if (result !== null) return result;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    if (Date.now() > deadline) fail(`timed out waiting for ${what} (last: ${last})`);
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

async function page(url: string): Promise<string> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.text();
}

type UserStat = { appDid: string; metric: string; value: number; label: string | null };
type AppStats = { metrics: { key: string; value: number; top: { value: number }[] }[] } | null;

// 3. Renown stored it (the relay flushes every 5 s).
const stored = await until("Renown to store the value", async () => {
  const data = await stats<{ userStats: UserStat[] }>(
    "query U($u: String!) { userStats(userDid: $u) { appDid metric value label } }",
    { u: user },
  );
  return data.userStats.find((s) => s.appDid === appDid && s.metric === metric && s.value === value) ?? null;
});
ok(`Renown userStats has ${metric}=${value}`);
if (stored.label === null) fail(`${metric} is not declared as a public metric: declare it in the app's Profile tab`);
ok(`${metric} is declared public ("${stored.label}")`);

// 4. appStats shows it, with this user among the top contributors.
const aggregate = await until("appStats to show the value", async () => {
  const data = await stats<{ appStats: AppStats }>(
    "query S($d: String!) { appStats(appDid: $d) { metrics { key value top { value } } } }",
    { d: appDid },
  );
  const m = data.appStats?.metrics.find((x) => x.key === metric);
  return m && m.top.some((t) => t.value === value) ? m : null;
});
ok(`appStats ${metric} = ${aggregate.value}`);

// 5. The public pages render it (server-rendered; markers carry raw values).
const tile = new RegExp(`data-metric="${metric.replace(/[.]/g, "\\.")}"[^>]*data-value="${aggregate.value}"`);
await until(`${web}/app/<did> to show the tile`, async () => (tile.test(await page(`${web}/app/${appDid}`)) ? true : null));
ok(`${web}/app/${appDid} shows ${metric}`);
if (address) {
  const row = new RegExp(`data-metric="${metric.replace(/[.]/g, "\\.")}"[^>]*data-value="${value}"`);
  await until("the user's profile to show the stat", async () => {
    const html = await page(`${web}/profile/${address}`);
    return html.includes(`data-app-did="${appDid}"`) && row.test(html) ? true : null;
  });
  ok(`${web}/profile/${address} shows ${metric}=${value}`);
} else {
  console.log("skip the user is not a did:pkh wallet, so there is no profile page to check");
}
console.log("PROVEN app stats flow end to end");
```

- [ ] **Step 6: Check it parses and refuses bad input; run types and lint.** `node --experimental-strip-types scripts/smoke/app-stats-proof.mts 2>&1 | tail -1` → `FAIL --namespace is required` (exit 1). `pnpm tsc 2>&1 | tail -5`, `pnpm lint 2>&1 | tail -5` → no errors (if `tsconfig.json` does not include `scripts/**/*.mts`, that is expected; the strip-types run above is its check).

- [ ] **Step 7: Commit.**

```bash
git add shared/report-user-stat.ts shared/report-user-stat.test.ts scripts/smoke/app-stats-proof.mts
git commit -m "feat(stats): reportUserStat helper for package authors and an end-to-end proof script"
```

## Part C — renown.id

Work in `/home/f/projects/renown-hub` on `feat/identity-hub` (`git switch feat/identity-hub && git pull --ff-only 2>/dev/null; git log --oneline -1`); Phase 2 Tasks 6–8 must be committed. Style: Tailwind tokens already used by the Phase 1/2 pages (`bg-secondary/60`, `text-foreground`, `text-muted-foreground`, `text-primary`, `rounded-2xl`), light and dark.

### Task 9: App page stats — tiles, active users, top contributors

**Files:**
- Create: `services/app-stats.ts`, `utils/stat-format.ts`, `components/app/app-stats.tsx`
- Modify: `pages/app/[did].tsx`, `e2e/support/stub-switchboard.mjs`
- Test: `e2e/stat-format.spec.ts`, `e2e/app-stats.spec.ts`

**Interfaces:**
- Consumes: Task 5 GraphQL (`appStats`, enriched `userStats` on `<switchboard>/graphql/renown-stats`); Phase 2 `switchboardOrigin()` (`services/media.ts`), the `/app/<did>` page and its `{/* Phase 3: public app stats (appStats) render here. */}` marker; Phase 1 `ProfileAvatar`, `shortAddress`.
- Produces:
  - `services/app-stats.ts`: types `MetricAggregation`, `MetricContributor`, `AppMetricStat`, `AppStats`, `UserStatEntry` (Task 5's GraphQL shapes); `getAppStats(appDid): Promise<AppStats | null>`; `getUserStats(address): Promise<UserStatEntry[]>` (errors → null / `[]`).
  - `utils/stat-format.ts`: `formatStatValue(value): string` (`1,234`, `12.5K`, `0.13`), `formatStatDate(iso): string` (`Oct 9, 2026`, UTC), `AGGREGATION_CAPTION: Record<MetricAggregation, string>`, `type AppStatGroup`, `groupUserStats(stats): AppStatGroup[]` (labelled entries only, by app, first-seen order).
  - `<AppStatsSection stats />` (nothing when there are neither metrics nor users); stat tiles carry `data-metric="<key>" data-value="<raw value>"` (the proof script reads them).
  - Stub: `DEFAULT_DATA` gains `appStats: null`, `userStats: []`.

- [ ] **Step 1: Write the failing specs.**

Create `e2e/stat-format.spec.ts` with exactly:

```ts
import { test, expect } from '@playwright/test'
import type { UserStatEntry } from '../services/app-stats'
import { formatStatDate, formatStatValue, groupUserStats } from '../utils/stat-format'

// Runs in the Playwright worker (Node): formatting and grouping behind the stats UI.
const entry = (appDid: string, metric: string, extra: Partial<UserStatEntry> = {}): UserStatEntry => ({
  appDid,
  metric,
  value: 1,
  updatedAt: '2026-10-09T00:00:00.000Z',
  appName: 'Vault',
  appDocumentId: 'doc-vault',
  appHasLogo: false,
  appLogo: null,
  label: metric,
  unit: null,
  ...extra,
})

test('formats stat values compactly and dates in UTC', () => {
  expect(formatStatValue(0)).toBe('0')
  expect(formatStatValue(-3)).toBe('-3')
  expect(formatStatValue(0.125)).toBe('0.13')
  expect(formatStatValue(1234)).toBe('1,234')
  expect(formatStatValue(12500)).toBe('12.5K')
  expect(formatStatValue(1234567)).toBe('1.2M')
  expect(formatStatDate('2026-10-09T23:30:00.000Z')).toBe('Oct 9, 2026')
})

test('groups only public (labelled) stats by app, in first-seen order', () => {
  const groups = groupUserStats([
    entry('did:a', 'notes'),
    entry('did:b', 'streak', { appName: null }),
    entry('did:a', 'raw', { label: null }),
    entry('did:a', 'score'),
    entry('did:c', 'x', { appDocumentId: null, label: null }),
  ])
  expect(groups.map((g) => [g.appDid, g.appName, g.entries.map((e) => e.metric)])).toEqual([
    ['did:a', 'Vault', ['notes', 'score']],
    ['did:b', 'Untitled app', ['streak']],
  ])
})
```

Create `e2e/app-stats.spec.ts` with exactly:

```ts
import { test, expect } from '@playwright/test'
import { fixtureStub } from './support/stub-switchboard-client'

// The app page's stats section, server-rendered against the stub switchboard.
// Ids no other spec uses (fixtures survive renown-writes.spec.ts's resets).
const APP_DID = 'did:key:z6MkStatsAppDidForE2eTests1111111111111111111'
const QUIET_DID = 'did:key:z6MkQuietAppDidForE2eTests1111111111111111111'
const ADA = '0x5e00000000000000000000000000000000000d01'
const BEN = '0x5e00000000000000000000000000000000000d02'
const KEY_USER = 'did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH'
const app = (appDid: string, name: string) => ({
  appDid,
  documentId: `doc-${name}`,
  name,
  tagline: null,
  logo: null,
  website: null,
  publisherDid: null,
  description: null,
  category: null,
  logoRef: null,
  coverRef: null,
  links: [],
})
const contributor = (userDid: string, value: number, extra: Record<string, unknown> = {}) => ({
  userDid,
  value,
  address: null,
  handle: null,
  displayName: null,
  documentId: null,
  hasAvatar: false,
  userImage: null,
  ...extra,
})
const STATS = {
  appDid: APP_DID,
  activeUsers30d: 5,
  totalUsers: 12,
  updatedAt: '2026-10-09T08:00:00.000Z',
  metrics: [
    {
      key: 'notes',
      label: 'Notes written',
      unit: 'notes',
      description: 'Notes across all vaults',
      aggregation: 'SUM',
      value: 1234,
      users: 9,
      top: [
        contributor(`did:pkh:eip155:1:${ADA}`, 900, {
          address: ADA,
          handle: 'ada',
          displayName: 'Ada',
          documentId: 'stub-avatar-doc',
          hasAvatar: true,
        }),
        contributor(`did:pkh:eip155:1:${BEN}`, 300, { address: BEN }),
        contributor(KEY_USER, 34),
      ],
    },
    { key: 'streak.days', label: 'Best streak', unit: null, description: null, aggregation: 'MAX', value: 42, users: 3, top: [] },
  ],
}

test.beforeAll(async () => {
  await fixtureStub({ match: 'appProfile(', variables: APP_DID, response: { data: { appProfile: app(APP_DID, 'Stats Vault') } } })
  await fixtureStub({ match: 'appStats(', variables: APP_DID, response: { data: { appStats: STATS } } })
  await fixtureStub({ match: 'appProfile(', variables: QUIET_DID, response: { data: { appProfile: app(QUIET_DID, 'Quiet') } } })
})

test.describe('app page stats', () => {
  test('shows tiles, active users and top contributors', async ({ page }) => {
    expect((await page.goto(`/app/${APP_DID}`))?.status()).toBe(200)
    await expect(page.getByRole('heading', { name: 'Stats', exact: true })).toBeVisible()
    await expect(page.getByText('Updated Oct 9, 2026')).toBeVisible()

    const notes = page.locator('[data-metric="notes"]')
    await expect(notes).toHaveAttribute('data-value', '1234')
    await expect(notes).toContainText('1,234')
    await expect(notes).toContainText('notes')
    await expect(notes).toContainText('Notes written')
    await expect(notes).toContainText('Total')
    await expect(page.locator('[data-metric="streak.days"]')).toContainText('42')
    await expect(page.locator('[data-metric="streak.days"]')).toContainText('Highest')
    await expect(page.getByText('of 12 users')).toBeVisible()

    await expect(page.getByRole('heading', { name: 'Top contributors' })).toBeVisible()
    const ada = page.getByRole('link', { name: /Ada/ })
    await expect(ada).toHaveAttribute('href', '/@ada')
    await expect(ada).toContainText('900 notes')
    await expect(ada.locator('img')).toHaveAttribute('src', '/media/stub-avatar-doc/avatar')
    await expect(page.getByRole('link', { name: /0x5e00…0d02/ })).toHaveAttribute('href', `/profile/${BEN}`)
    await expect(page.getByText('34 notes')).toBeVisible()
  })

  test('an app without stats shows no stats section', async ({ page }) => {
    expect((await page.goto(`/app/${QUIET_DID}`))?.status()).toBe(200)
    await expect(page.getByRole('heading', { name: 'Quiet' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Stats', exact: true })).toHaveCount(0)
  })
})
```

(`shortAddress` in Phase 1's `profile-summary.tsx` renders `0x5e00…0d02`; if your copy formats differently, match its output in that one assertion.)

- [ ] **Step 2: Run them to see them fail.** `pnpm exec playwright test e2e/stat-format.spec.ts e2e/app-stats.spec.ts 2>&1 | tail -15` → FAIL (`Cannot find module '../utils/stat-format'`; no Stats section).

- [ ] **Step 3: Implement.**

Create `services/app-stats.ts` with exactly:

```ts
// App stats from renown-stats (<switchboard>/graphql/renown-stats). Public
// reads; failures are logged and read as "no stats", like getAppProfile.
import { GraphQLClient } from 'graphql-request'
import { switchboardOrigin } from './media'

export type MetricAggregation = 'SUM' | 'MAX' | 'AVG' | 'COUNT_USERS'

export interface MetricContributor {
  userDid: string
  value: number
  /** The wallet behind a did:pkh user; null for did:key users. */
  address: string | null
  handle: string | null
  displayName: string | null
  /** Renown profile document (avatar at /media/<documentId>/avatar when hasAvatar). */
  documentId: string | null
  hasAvatar: boolean
  userImage: string | null
}

export interface AppMetricStat {
  key: string
  label: string
  unit: string | null
  description: string | null
  aggregation: MetricAggregation
  value: number
  users: number
  top: MetricContributor[]
}

export interface AppStats {
  appDid: string
  activeUsers30d: number
  totalUsers: number
  metrics: AppMetricStat[]
  updatedAt: string | null
}

export interface UserStatEntry {
  appDid: string
  metric: string
  value: number
  updatedAt: string
  appName: string | null
  appDocumentId: string | null
  appHasLogo: boolean
  appLogo: string | null
  /** Set when the app declares the metric public. */
  label: string | null
  unit: string | null
}

const STATS_FIELDS = `appDid activeUsers30d totalUsers updatedAt metrics { key label unit description aggregation value users top { userDid value address handle displayName documentId hasAvatar userImage } }`
const USER_STAT_FIELDS = `appDid metric value updatedAt appName appDocumentId appHasLogo appLogo label unit`

function client(): GraphQLClient {
  return new GraphQLClient(`${switchboardOrigin()}/graphql/renown-stats`)
}

export async function getAppStats(appDid: string): Promise<AppStats | null> {
  try {
    const data = await client().request<{ appStats?: AppStats | null }>(
      `query AppStats($appDid: String!) { appStats(appDid: $appDid) { ${STATS_FIELDS} } }`,
      { appDid },
    )
    return data.appStats ?? null
  } catch (error) {
    console.error('Failed to fetch app stats:', error)
    return null
  }
}

/** A wallet's stats across apps (Renown folds every chain of a did:pkh into one). */
export async function getUserStats(address: string): Promise<UserStatEntry[]> {
  try {
    const data = await client().request<{ userStats?: UserStatEntry[] }>(
      `query UserStats($userDid: String!) { userStats(userDid: $userDid) { ${USER_STAT_FIELDS} } }`,
      { userDid: `did:pkh:eip155:1:${address.toLowerCase()}` },
    )
    return data.userStats ?? []
  } catch (error) {
    console.error('Failed to fetch user stats:', error)
    return []
  }
}
```

Create `utils/stat-format.ts` with exactly:

```ts
import type { MetricAggregation, UserStatEntry } from '../services/app-stats'

/** 1,234 · 12.5K · 1.2M · 0.13 — compact from 10,000 on. Same output on server and client. */
export function formatStatValue(value: number): string {
  const options: Intl.NumberFormatOptions =
    Math.abs(value) >= 10_000 ? { notation: 'compact', maximumFractionDigits: 1 } : { maximumFractionDigits: 2 }
  return new Intl.NumberFormat('en-US', options).format(value)
}

/** "Oct 9, 2026" in UTC, so server and client render the same text. */
export function formatStatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** How a tile names its aggregation. */
export const AGGREGATION_CAPTION: Record<MetricAggregation, string> = {
  SUM: 'Total',
  MAX: 'Highest',
  AVG: 'Average',
  COUNT_USERS: 'Users',
}

export interface AppStatGroup {
  appDid: string
  appName: string
  appDocumentId: string
  appHasLogo: boolean
  appLogo: string | null
  entries: UserStatEntry[]
}

/** What a profile shows: stats of metrics their app declares public, grouped by app in first-seen order. */
export function groupUserStats(stats: UserStatEntry[]): AppStatGroup[] {
  const groups = new Map<string, AppStatGroup>()
  for (const stat of stats) {
    if (stat.label === null || stat.appDocumentId === null) continue
    let group = groups.get(stat.appDid)
    if (!group) {
      group = {
        appDid: stat.appDid,
        appName: stat.appName || 'Untitled app',
        appDocumentId: stat.appDocumentId,
        appHasLogo: stat.appHasLogo,
        appLogo: stat.appLogo,
        entries: [],
      }
      groups.set(stat.appDid, group)
    }
    group.entries.push(stat)
  }
  return [...groups.values()]
}
```

Create `components/app/app-stats.tsx` with exactly:

```tsx
import Link from 'next/link'
import type { ReactNode } from 'react'
import type { AppMetricStat, AppStats, MetricContributor } from '../../services/app-stats'
import { AGGREGATION_CAPTION, formatStatDate, formatStatValue } from '../../utils/stat-format'
import { ProfileAvatar } from '../profile/profile-avatar'
import { shortAddress } from '../profile/profile-summary'

function contributorName(c: MetricContributor): string {
  if (c.displayName) return c.displayName
  if (c.handle) return `@${c.handle}`
  if (c.address) return shortAddress(c.address)
  return `${c.userDid.slice(0, 16)}…${c.userDid.slice(-4)}`
}

function contributorHref(c: MetricContributor): string | null {
  if (c.handle) return `/@${c.handle}`
  if (c.address) return `/profile/${c.address}`
  return null
}

function withUnit(value: number, unit: string | null): string {
  return unit ? `${formatStatValue(value)} ${unit}` : formatStatValue(value)
}

function StatTile({
  caption,
  value,
  unit,
  label,
  metricKey,
  title,
}: {
  caption: string
  value: number
  unit: string | null
  label: string
  metricKey?: string
  title?: string
}) {
  return (
    <div className="bg-secondary/60 min-w-0 rounded-2xl p-4" data-metric={metricKey} data-value={String(value)} title={title}>
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{caption}</p>
      <p className="text-foreground mt-1 flex items-baseline gap-1.5">
        <span className="text-2xl font-bold tabular-nums">{formatStatValue(value)}</span>
        {unit && <span className="text-muted-foreground truncate text-sm">{unit}</span>}
      </p>
      <p className="text-foreground/80 mt-0.5 truncate text-sm">{label}</p>
    </div>
  )
}

function Leaderboard({ metric }: { metric: AppMetricStat }) {
  return (
    <div className="rounded-2xl border border-gray-200 p-4 dark:border-white/10">
      <h4 className="text-foreground text-sm font-semibold">{metric.label}</h4>
      <ol className="mt-3 space-y-1">
        {metric.top.map((c, i) => {
          const href = contributorHref(c)
          const body: ReactNode = (
            <>
              <span className="text-muted-foreground w-4 shrink-0 text-xs tabular-nums">{i + 1}</span>
              <ProfileAvatar
                documentId={c.documentId}
                hasAvatar={c.hasAvatar}
                userImage={c.userImage}
                seed={c.address ?? c.userDid}
                alt=""
                className="h-7 w-7 shrink-0"
              />
              <span className="text-foreground min-w-0 flex-1 truncate text-sm">{contributorName(c)}</span>
              <span className="text-foreground shrink-0 text-sm font-semibold tabular-nums">{withUnit(c.value, metric.unit)}</span>
            </>
          )
          return (
            <li key={c.userDid}>
              {href ? (
                <Link href={href} className="hover:bg-secondary/60 -mx-2 flex items-center gap-3 rounded-lg px-2 py-1 transition-colors">
                  {body}
                </Link>
              ) : (
                <div className="flex items-center gap-3 py-1">{body}</div>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/** The public app page's stats: active users, one tile per public metric, top contributors. */
export function AppStatsSection({ stats }: { stats: AppStats }) {
  if (stats.metrics.length === 0 && stats.totalUsers === 0) return null
  const boards = stats.metrics.filter((m) => m.top.length > 0)
  return (
    <section aria-labelledby="app-stats-heading" className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="app-stats-heading" className="text-foreground text-lg font-semibold">
          Stats
        </h2>
        {stats.updatedAt && <span className="text-muted-foreground text-xs">Updated {formatStatDate(stats.updatedAt)}</span>}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile
          caption="Active · 30 days"
          value={stats.activeUsers30d}
          unit={null}
          label={`of ${formatStatValue(stats.totalUsers)} users`}
        />
        {stats.metrics.map((m) => (
          <StatTile
            key={m.key}
            metricKey={m.key}
            caption={AGGREGATION_CAPTION[m.aggregation]}
            value={m.value}
            unit={m.unit}
            label={m.label}
            title={m.description ?? undefined}
          />
        ))}
      </div>
      {boards.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-foreground text-sm font-semibold">Top contributors</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {boards.map((m) => (
              <Leaderboard key={m.key} metric={m} />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
```

In `pages/app/[did].tsx` (as Phase 2 Task 7 created it):
1. Add imports below `import { AppLogo } from '../../components/app/app-logo'`:

```tsx
import { AppStatsSection } from '../../components/app/app-stats'
import { getAppStats, type AppStats } from '../../services/app-stats'
```

2. In `interface AppPageProps`, after `  app: RenownAppProfile | null`, add `  stats: AppStats | null`.
3. Change the component signature `({ app, publisher, publisherAddress, canonicalUrl, ogImage })` to `({ app, stats, publisher, publisherAddress, canonicalUrl, ogImage })`.
4. Replace `            {/* Phase 3: public app stats (appStats) render here. */}` with `            {stats && <AppStatsSection stats={stats} />}`.
5. Replace `  const empty: AppPageProps = { app: null, publisher: null, publisherAddress: null, canonicalUrl: null, ogImage: null }` with `  const empty: AppPageProps = { app: null, stats: null, publisher: null, publisherAddress: null, canonicalUrl: null, ogImage: null }`.
6. Replace:

```tsx
  const publisher = publisherAddress
    ? await getProfile({ driveId: `renown-${publisherAddress}`, ethAddress: publisherAddress })
    : null
```

with:

```tsx
  const [publisher, stats] = await Promise.all([
    publisherAddress ? getProfile({ driveId: `renown-${publisherAddress}`, ethAddress: publisherAddress }) : Promise.resolve(null),
    getAppStats(did),
  ])
```

7. Replace:

```tsx
    props: { app, publisher, publisherAddress, canonicalUrl: `${origin}/app/${did}`, ogImage },
```

with:

```tsx
    props: { app, stats, publisher, publisherAddress, canonicalUrl: `${origin}/app/${did}`, ogImage },
```

In `e2e/support/stub-switchboard.mjs` replace:

```js
  appProfile: null,
  appProfilesByPublisher: [],
}
```

with:

```js
  appProfile: null,
  appProfilesByPublisher: [],
  appStats: null,
  userStats: [],
}
```

- [ ] **Step 4: Run specs, types, lint.** `pnpm exec playwright test e2e/stat-format.spec.ts e2e/app-stats.spec.ts e2e/app-pages.spec.ts 2>&1 | tail -15` → PASS (Phase 2's app page spec unchanged: its app has no stats). `pnpm exec tsc --noEmit -p . 2>&1 | tail -5`, `pnpm lint 2>&1 | tail -5` → no errors.

- [ ] **Step 5: Look at it.** `pnpm dev` with `NEXT_PUBLIC_SWITCHBOARD_ENDPOINT=https://switchboard.renown-staging.vetra.io/graphql` once Task 14 has released renown-package to staging (until then, the stub: `node e2e/support/stub-switchboard.mjs` + the spec's fixtures). Check light and dark, 375 px and desktop: tiles wrap 2-up on mobile, long labels truncate with a tooltip from the description, the leaderboard never scrolls horizontally.

- [ ] **Step 6: Commit.**

```bash
git add services/app-stats.ts utils/stat-format.ts components/app/app-stats.tsx pages/app/[did].tsx e2e/support/stub-switchboard.mjs e2e/stat-format.spec.ts e2e/app-stats.spec.ts
git commit -m "feat(apps): stat tiles, active users and top contributors on app pages"
```

### Task 10: "Stats" on user profiles, grouped by app

**Files:**
- Create: `components/profile/profile-stats.tsx`
- Modify: `pages/profile/[id].tsx`
- Test: `e2e/profile-stats.spec.ts`

**Interfaces:**
- Consumes: Task 9 `getUserStats`, `UserStatEntry`, `groupUserStats`, `formatStatValue`; Phase 2 `AppLogo` (`components/app/app-logo.tsx`), the profile page with its "Apps published" section.
- Produces: `<ProfileStats stats />` (nothing when no app declares a public metric the user has); each app group carries `data-app-did`, each metric `data-metric` + `data-value` (raw); profile page prop `stats: UserStatEntry[]`.

- [ ] **Step 1: Write the failing spec.**

Create `e2e/profile-stats.spec.ts` with exactly:

```ts
import { test, expect } from '@playwright/test'
import { fixtureStub } from './support/stub-switchboard-client'

const MAKER = '0x5e00000000000000000000000000000000000e01'
const QUIET = '0x5e00000000000000000000000000000000000e02'
const ALPHA = 'did:key:z6MkAbcStatsAppForE2eTests1111111111111111111'
const BETA = 'did:key:z6MkBetaStatsAppForE2eTests111111111111111111'
const GAMMA = 'did:key:z6MkGammaStatsAppForE2eTests11111111111111111'
const profile = (handle: string, address: string, displayName: string) => ({
  documentId: `doc-${handle}`,
  username: handle,
  ethAddress: address,
  userImage: null,
  displayName,
  handle,
  bio: null,
  links: [],
  avatar: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})
const stat = (appDid: string, metric: string, value: number, extra: Record<string, unknown> = {}) => ({
  appDid,
  metric,
  value,
  updatedAt: '2026-10-09T00:00:00.000Z',
  appName: 'Alpha Notes',
  appDocumentId: 'stub-app-doc',
  appHasLogo: true,
  appLogo: null,
  label: null,
  unit: null,
  ...extra,
})

test.beforeAll(async () => {
  const users = (p: unknown) => ({ data: { renownUsers: [p] } })
  await fixtureStub({ match: 'renownUsers', variables: '"stats-maker"', response: users(profile('stats-maker', MAKER, 'Sam Stats')) })
  await fixtureStub({ match: 'renownUsers', variables: '"no-stats-maker"', response: users(profile('no-stats-maker', QUIET, 'Quinn Quiet')) })
  await fixtureStub({
    match: 'userStats(',
    variables: MAKER,
    response: {
      data: {
        userStats: [
          stat(ALPHA, 'notes', 1234, { label: 'Notes written', unit: 'notes' }),
          stat(ALPHA, 'raw', 5),
          stat(BETA, 'streak', 7, { appName: 'Beta', appDocumentId: 'doc-beta', appHasLogo: false, label: 'Best streak' }),
          stat(GAMMA, 'x', 1, { appName: null, appDocumentId: null, appHasLogo: false }),
        ],
      },
    },
  })
})

test('a profile shows its public stats grouped by app', async ({ page }) => {
  expect((await page.goto('/@stats-maker'))?.status()).toBe(200)
  await expect(page.getByRole('heading', { name: 'Stats', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: /Alpha Notes/ })).toHaveAttribute('href', `/app/${ALPHA}`)
  await expect(page.locator('img[alt="Alpha Notes logo"]')).toHaveAttribute('src', '/media/stub-app-doc/logo')
  const notes = page.locator(`[data-app-did="${ALPHA}"] [data-metric="notes"]`)
  await expect(notes).toHaveAttribute('data-value', '1234')
  await expect(notes).toContainText('Notes written')
  await expect(notes).toContainText('1,234')
  await expect(notes).toContainText('notes')
  await expect(page.locator('[data-metric="raw"]')).toHaveCount(0)
  await expect(page.locator(`[data-app-did="${BETA}"] [data-metric="streak"]`)).toContainText('Best streak')
  await expect(page.getByRole('link', { name: /Beta/ })).toHaveAttribute('href', `/app/${BETA}`)
  await expect(page.locator(`[data-app-did="${GAMMA}"]`)).toHaveCount(0)
})

test('a profile without public stats shows no stats section', async ({ page }) => {
  expect((await page.goto('/@no-stats-maker'))?.status()).toBe(200)
  await expect(page.getByRole('heading', { name: 'Quinn Quiet' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Stats', exact: true })).toHaveCount(0)
})
```

- [ ] **Step 2: Run it to see it fail.** `pnpm exec playwright test e2e/profile-stats.spec.ts 2>&1 | tail -15` → FAIL (no Stats section).

- [ ] **Step 3: Implement.**

Create `components/profile/profile-stats.tsx` with exactly:

```tsx
import Link from 'next/link'
import type { UserStatEntry } from '../../services/app-stats'
import { formatStatValue, groupUserStats } from '../../utils/stat-format'
import { AppLogo } from '../app/app-logo'

/** The user's public app stats, one card per app (logo and name link to the app page). */
export function ProfileStats({ stats }: { stats: UserStatEntry[] }) {
  const groups = groupUserStats(stats)
  if (groups.length === 0) return null
  return (
    <section aria-labelledby="profile-stats" className="space-y-3">
      <h2 id="profile-stats" className="text-foreground px-1 text-lg font-semibold">
        Stats
      </h2>
      <div className="grid gap-3">
        {groups.map((group) => (
          <div key={group.appDid} data-app-did={group.appDid} className="bg-secondary/60 rounded-2xl p-4">
            <Link href={`/app/${group.appDid}`} className="group inline-flex max-w-full items-center gap-3">
              <AppLogo
                documentId={group.appDocumentId}
                hasLogo={group.appHasLogo}
                legacyLogo={group.appLogo}
                name={group.appName}
                className="h-9 w-9 text-sm ring-2"
              />
              <span className="text-foreground truncate font-semibold group-hover:underline">{group.appName}</span>
            </Link>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
              {group.entries.map((entry) => (
                <div key={entry.metric} className="min-w-0" data-metric={entry.metric} data-value={String(entry.value)}>
                  <dt className="text-muted-foreground truncate text-xs">{entry.label}</dt>
                  <dd className="text-foreground flex items-baseline gap-1">
                    <span className="text-xl font-bold tabular-nums">{formatStatValue(entry.value)}</span>
                    {entry.unit && <span className="text-muted-foreground truncate text-xs">{entry.unit}</span>}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </section>
  )
}
```

In `pages/profile/[id].tsx` (as Phase 2 Task 8 left it):
1. Add imports:

```tsx
import { ProfileStats } from '../../components/profile/profile-stats'
import { getUserStats, type UserStatEntry } from '../../services/app-stats'
```

2. In `interface ProfilePageProps`, after `  apps: RenownAppProfile[]`, add `  stats: UserStatEntry[]`.
3. Change the component signature `({ profile, ensVerified, apps, canonicalUrl, ogImage, error })` to `({ profile, ensVerified, apps, stats, canonicalUrl, ogImage, error })`.
4. Replace:

```tsx
                    {apps.map((app) => (
                      <AppProfileCard key={app.appDid} app={app} />
                    ))}
                  </div>
                </section>
              )}
```

with:

```tsx
                    {apps.map((app) => (
                      <AppProfileCard key={app.appDid} app={app} />
                    ))}
                  </div>
                </section>
              )}
              <ProfileStats stats={stats} />
```

5. Replace `const empty = { profile: null, ensVerified: false, apps: [], canonicalUrl: null, ogImage: null }` with `const empty = { profile: null, ensVerified: false, apps: [], stats: [], canonicalUrl: null, ogImage: null }`.
6. Replace:

```tsx
  const [ensVerified, apps] = await Promise.all([
    isEnsVerified(profile.username, profile.ethAddress),
    ADDRESS_RE.test(address) ? getAppProfilesByPublisher(address.toLowerCase()) : Promise.resolve([]),
  ])
```

with:

```tsx
  const wallet = ADDRESS_RE.test(address)
  const [ensVerified, apps, stats] = await Promise.all([
    isEnsVerified(profile.username, profile.ethAddress),
    wallet ? getAppProfilesByPublisher(address.toLowerCase()) : Promise.resolve([]),
    wallet ? getUserStats(address) : Promise.resolve([]),
  ])
```

7. Replace:

```tsx
      apps,
      canonicalUrl: `${origin}${profilePath(profile)}`,
```

with:

```tsx
      apps,
      stats,
      canonicalUrl: `${origin}${profilePath(profile)}`,
```

- [ ] **Step 4: Run specs, types, lint.** `pnpm exec playwright test e2e/profile-stats.spec.ts e2e/profile-apps.spec.ts e2e/profile-pages.spec.ts 2>&1 | tail -15` → PASS. `pnpm exec tsc --noEmit -p . 2>&1 | tail -5`, `pnpm lint 2>&1 | tail -5` → no errors.

- [ ] **Step 5: Commit.**

```bash
git add components/profile/profile-stats.tsx pages/profile/[id].tsx e2e/profile-stats.spec.ts
git commit -m "feat(profile): stats grouped by app on user profiles"
```

## Part D — vetra.io

Work in `/home/f/projects/vetra.io-hub` on `feat/identity-hub` (`git switch feat/identity-hub && git pull --ff-only 2>/dev/null; git log --oneline -1`); Phase 2 Tasks 9–11 must be committed. Style: shadcn components from `@/modules/shared/components/ui/*`, `cn` from `@/shared/lib/utils`, lucide icons, sentence-case copy, no new dependencies.

### Task 11: Docs page "Report app stats"

**Files:**
- Create: `modules/docs/report-user-stat-snippet.ts`, `app/docs/app-stats/page.tsx`
- Test: `app/docs/app-stats/__tests__/page.test.tsx`

**Interfaces:**
- Consumes: Task 8's `shared/report-user-stat.ts` (copied verbatim), the reporting contract (Global Constraints); `CodeBlock` (`modules/apps/components/code-block.tsx`), `Button`.
- Produces: page `/docs/app-stats` (linked from Task 12's Metrics section and Task 13's empty state); `REPORT_USER_STAT_SNIPPET`, `USAGE_SNIPPET`, `CURL_SNIPPET` (`modules/docs/report-user-stat-snippet.ts`).

- [ ] **Step 1: Write the failing test.**

Create `app/docs/app-stats/__tests__/page.test.tsx` with exactly:

```tsx
import { cleanup, render, screen } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { REPORT_USER_STAT_SNIPPET } from '@/modules/docs/report-user-stat-snippet'
import AppStatsDocsPage from '../page'

afterEach(() => cleanup())

describe('/docs/app-stats', () => {
  it('documents the variables, the header, the mutation and the semantics', () => {
    render(<AppStatsDocsPage />)
    expect(screen.getByRole('heading', { level: 1, name: 'Report app stats' })).toBeTruthy()
    for (const text of ['VETRA_REPORTING_TOKEN', 'VETRA_LICENSING_URL', 'x-vetra-reporting-token']) {
      expect(screen.getAllByText(text).length).toBeGreaterThan(0)
    }
    expect(screen.getByText(/current value, not an increment/i)).toBeTruthy()
    for (const id of ['how-it-works', 'declare', 'environment', 'report', 'semantics', 'helper', 'troubleshooting']) {
      expect(document.getElementById(id)).not.toBeNull()
    }
    expect(screen.getByRole('link', { name: /Open your apps/ }).getAttribute('href')).toBe('/user/apps')
  })

  it('ships the tested helper verbatim', () => {
    expect(REPORT_USER_STAT_SNIPPET).toContain('export async function reportUserStat(')
    expect(REPORT_USER_STAT_SNIPPET).toContain('"x-vetra-reporting-token": token')
    expect(REPORT_USER_STAT_SNIPPET).toContain('vetraLicensing { reportUserStat(user: $user, metric: $metric, value: $value) }')
  })
})
```

- [ ] **Step 2: Run it to see it fail.** `pnpm test:unit -- app/docs/app-stats 2>&1 | tail -10` → FAIL (`Failed to resolve import "../page"`).

- [ ] **Step 3: Implement.**

Create `modules/docs/report-user-stat-snippet.ts`. Its first constant is the file Task 8 created, **verbatim** — paste the whole of `/home/f/projects/vetra-cloud-package-profiles/shared/report-user-stat.ts` between the backticks (it contains no `${` and no backslashes; only the two backticks around `metric` in its JSDoc need escaping):

```ts
// Code shown on /docs/app-stats. REPORT_USER_STAT_SNIPPET is a verbatim copy of
// vetra-cloud-package shared/report-user-stat.ts, the unit-tested original.

export const REPORT_USER_STAT_SNIPPET = `// Report a user's current value of an app metric to Vetra, which relays it
// to Renown: the app's page (renown.id/app/<app DID>) and the user's profile.
//
// Vetra gives each licensed environment two variables:
//   VETRA_REPORTING_TOKEN  this environment's reporting token (a secret)
//   VETRA_LICENSING_URL    the endpoint to call
// Without them (local development) nothing is sent and the result is false.
//
// Dependency-free: copy this file into your package.
// Docs: https://vetra.io/docs/app-stats

const METRIC = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;
const MUTATION =
  "mutation ReportUserStat($user: String!, $metric: String!, $value: Float!) " +
  "{ vetraLicensing { reportUserStat(user: $user, metric: $metric, value: $value) } }";

export class ReportUserStatError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ReportUserStatError";
    this.code = code;
  }
}

export interface ReportUserStatOptions {
  /** Where the two variables are read from (default: process.env). */
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  /** Default 10000 ms. */
  timeoutMs?: number;
}

type Answer = {
  data?: { vetraLicensing?: { reportUserStat?: unknown } | null } | null;
  errors?: { message?: string; extensions?: { code?: unknown } }[];
} | null;

/**
 * Sends the user's CURRENT value of \`metric\` (not a delta: the newest report
 * wins). Resolves true when Vetra queued it for Renown, false when nothing was
 * sent (not on Vetra) or Vetra did not relay it (the user is not this
 * environment's licence holder, the app has no usable Renown identity, or
 * Renown refused the app recently). Throws ReportUserStatError for an invalid
 * metric or value (INVALID_INPUT), an unknown token (UNAUTHENTICATED), or when
 * Vetra cannot be reached (NETWORK, HTTP_<status>).
 */
export async function reportUserStat(
  user: string,
  metric: string,
  value: number,
  options: ReportUserStatOptions = {},
): Promise<boolean> {
  const env = options.env ?? process.env;
  const url = env.VETRA_LICENSING_URL?.trim();
  const token = env.VETRA_REPORTING_TOKEN?.trim();
  if (!url || !token) return false;
  if (!METRIC.test(metric)) {
    throw new ReportUserStatError("INVALID_INPUT", "metric must match " + METRIC.source);
  }
  if (!Number.isFinite(value)) {
    throw new ReportUserStatError("INVALID_INPUT", "value must be a finite number");
  }
  let res: Response;
  try {
    res = await (options.fetch ?? fetch)(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-vetra-reporting-token": token },
      body: JSON.stringify({ query: MUTATION, variables: { user, metric, value } }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 10000),
    });
  } catch (error) {
    throw new ReportUserStatError("NETWORK", error instanceof Error ? error.message : "request failed");
  }
  const answer = (await res.json().catch(() => null)) as Answer;
  const error = answer?.errors?.[0];
  if (error) {
    const code = typeof error.extensions?.code === "string" ? error.extensions.code : "ERROR";
    throw new ReportUserStatError(code, error.message ?? "reportUserStat failed");
  }
  if (!res.ok) {
    throw new ReportUserStatError("HTTP_" + String(res.status), "Vetra answered " + String(res.status));
  }
  return answer?.data?.vetraLicensing?.reportUserStat === true;
}
`

export const USAGE_SNIPPET = `import { reportUserStat } from "./report-user-stat.js";

// In a processor or subgraph of your package, after the user acted.
// Send the user's CURRENT total, not the increment.
const relayed = await reportUserStat(userDid, "notes", notesWritten).catch((error: unknown) => {
  console.warn("app stat not reported", error);
  return false;
});
`

export const CURL_SNIPPET = String.raw`curl -s "$VETRA_LICENSING_URL" \
  -H 'content-type: application/json' \
  -H "x-vetra-reporting-token: $VETRA_REPORTING_TOKEN" \
  -d '{"query":"mutation { vetraLicensing { reportUserStat(user: \"did:pkh:eip155:1:0xHolderAddress\", metric: \"notes\", value: 42) } }"}'`
```

(The one change from the original file is the escaped `` \` `` around `metric` inside the JSDoc, which the template literal requires; the rendered snippet shows plain backticks.)

Create `app/docs/app-stats/page.tsx` with exactly:

```tsx
import { ArrowRight } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'

import { CodeBlock } from '@/modules/apps/components/code-block'
import { CURL_SNIPPET, REPORT_USER_STAT_SNIPPET, USAGE_SNIPPET } from '@/modules/docs/report-user-stat-snippet'
import { Button } from '@/modules/shared/components/ui/button'

export const metadata: Metadata = {
  title: 'Report app stats',
  description:
    'Report users’ metric values from your Vetra environments. Renown shows them on your app page and on users’ profiles.',
}

const TOC = [
  { id: 'how-it-works', label: 'How it works' },
  { id: 'declare', label: 'Declare metrics' },
  { id: 'environment', label: 'Environment' },
  { id: 'report', label: 'Report a value' },
  { id: 'semantics', label: 'Semantics' },
  { id: 'helper', label: 'Helper' },
  { id: 'troubleshooting', label: 'Troubleshooting' },
] as const

const AGGREGATIONS: Array<[string, string, string]> = [
  ['Total (SUM)', 'Adds every user’s current value.', 'Notes written by everyone'],
  ['Highest (MAX)', 'The highest current value of any user.', 'Longest streak'],
  ['Average (AVG)', 'The mean of users’ current values.', 'Average score'],
  ['Users (COUNT_USERS)', 'How many users have a value above zero.', 'Users who published'],
]

const MUTATION = `mutation ReportUserStat($user: String!, $metric: String!, $value: Float!) {
  vetraLicensing {
    reportUserStat(user: $user, metric: $metric, value: $value)
  }
}`

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 space-y-5">
      <h2 className="text-2xl font-semibold tracking-tight">
        <a href={`#${id}`} className="hover:text-primary">
          {title}
        </a>
      </h2>
      {children}
    </section>
  )
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-foreground/80 leading-7">{children}</p>
}

function C({ children }: { children: React.ReactNode }) {
  return <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-[0.85em]">{children}</code>
}

function DataTable({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="border-border overflow-x-auto rounded-xl border">
      <table className="w-full text-left text-sm">
        <thead className="bg-muted/50">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="px-4 py-2.5 font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-border divide-y">
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} className="text-foreground/80 px-4 py-2.5 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Problem({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border-border rounded-xl border p-5">
      <p className="font-medium">{title}</p>
      <div className="text-foreground/80 mt-2 space-y-2 text-sm leading-6">{children}</div>
    </div>
  )
}

export default function AppStatsDocsPage() {
  return (
    <div className="mx-auto mt-16 max-w-screen-xl px-4 py-12 sm:px-6">
      <div className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-12">
        <aside className="hidden lg:block">
          <nav aria-label="On this page" className="sticky top-24 space-y-1 text-sm">
            <p className="text-muted-foreground mb-3 text-xs font-semibold tracking-wide uppercase">On this page</p>
            {TOC.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className="text-muted-foreground hover:text-foreground block rounded-md py-1 transition-colors"
              >
                {item.label}
              </a>
            ))}
          </nav>
        </aside>

        <article className="max-w-3xl min-w-0 space-y-14">
          <header className="space-y-5">
            <span className="bg-primary/10 text-primary inline-flex rounded-full px-3 py-1 text-xs font-medium">
              Guide
            </span>
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Report app stats</h1>
            <p className="text-muted-foreground text-lg leading-8">
              Your environments report each user’s current value of the metrics you declare. Renown adds them up and
              shows them on your app’s public page and on every user’s profile.
            </p>
            <Button asChild size="lg">
              <Link href="/user/apps">
                Open your apps
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </header>

          <Section id="how-it-works" title="How it works">
            <P>
              Your package code, running in an environment Vetra provisioned for a licence holder, calls Vetra with the
              environment’s reporting token. Vetra checks the environment, its licence and your app’s Renown identity,
              then forwards the value to Renown as your app. Renown keeps one current value per user and metric.
            </P>
            <P>
              Values show up on <C>renown.id/app/&lt;your app DID&gt;</C> (stat tiles, active users over 30 days, top
              contributors) and in the Stats section of each user’s profile, but only for metrics you declare as public.
            </P>
          </Section>

          <Section id="declare" title="Declare metrics">
            <P>
              Open your app on Vetra, go to the <strong>Profile</strong> tab and add metrics in the{' '}
              <strong>Metrics</strong> section: a label, the key your code reports, an optional unit, how values are
              combined, and whether it is public. Up to 16 metrics. Keys start with a letter and use letters, digits and{' '}
              <C>_ . : -</C> (at most 64 characters).
            </P>
            <DataTable
              head={['Aggregation', 'Shows', 'Example']}
              rows={AGGREGATIONS.map(([name, shows, example]) => [<strong key="n">{name}</strong>, shows, example])}
            />
            <P>
              A key you report but have not declared is stored, but not shown. Declare it later and its history appears.
            </P>
          </Section>

          <Section id="environment" title="Environment">
            <P>Vetra writes two variables into each licensed environment’s secrets:</P>
            <DataTable
              head={['Variable', 'What it is']}
              rows={[
                [
                  <C key="t">VETRA_REPORTING_TOKEN</C>,
                  'This environment’s reporting token. A secret: send it only in the header below, never log it.',
                ],
                [<C key="u">VETRA_LICENSING_URL</C>, 'The endpoint to call, for example https://switchboard.vetra.io/graphql/vetra-licensing.'],
              ]}
            />
            <P>
              The first time Vetra writes them, the environment restarts once to pick them up. Local development has
              neither, and the helper below then sends nothing.
            </P>
          </Section>

          <Section id="report" title="Report a value">
            <P>
              Send the token in the <C>x-vetra-reporting-token</C> header (not <C>Authorization</C>), to{' '}
              <C>VETRA_LICENSING_URL</C> directly:
            </P>
            <CodeBlock code={MUTATION} filename="reportUserStat.graphql" />
            <CodeBlock code={CURL_SNIPPET} filename="shell" />
            <P>
              <C>user</C> is the user’s DID, for example <C>did:pkh:eip155:1:0x…</C>; <C>value</C> is any finite number.
            </P>
          </Section>

          <Section id="semantics" title="Semantics">
            <ul className="text-foreground/80 list-disc space-y-2 pl-5 leading-7">
              <li>Report the current value, not an increment. The newest report per user and metric wins.</li>
              <li>
                Sending the same value again is cheap and keeps the user counted as active (any report in the last 30
                days).
              </li>
              <li>
                <C>true</C> means queued: Renown has it within seconds, and pages refresh within a minute.
              </li>
              <li>
                <C>false</C> means not relayed: the user is not this environment’s licence holder, your app has no usable
                Renown identity (authorize it on the app’s Overview), or Renown refused your app in the last five minutes.
              </li>
              <li>
                Only environments Vetra provisions for a licence can report, and only for their holder. At most 32 metrics
                per user per app, 600 reports per minute per app.
              </li>
            </ul>
          </Section>

          <Section id="helper" title="Helper">
            <P>
              A dependency-free TypeScript file you can copy into your package. It reads the two variables, validates
              the metric and value, and resolves to <C>true</C> when Vetra queued the report.
            </P>
            <CodeBlock code={USAGE_SNIPPET} filename="usage.ts" />
            <CodeBlock code={REPORT_USER_STAT_SNIPPET} filename="report-user-stat.ts" />
          </Section>

          <Section id="troubleshooting" title="Troubleshooting">
            <div className="space-y-3">
              <Problem title="The variables are missing">
                <p>
                  Only environments provisioned for a licence get them, a few at a time; the environment restarts once
                  when they arrive. Wait a minute and check again.
                </p>
              </Problem>
              <Problem title="UNAUTHENTICATED: unknown reporting token">
                <p>
                  The token is from an earlier environment or was replaced. Restart the environment so it reads its
                  current secret.
                </p>
              </Problem>
              <Problem title="The call returns false">
                <p>
                  Report for the environment’s licence holder, and check that your app’s Renown identity is authorized on
                  its Overview. After a refusal Renown pauses your app for five minutes.
                </p>
              </Problem>
              <Problem title="Values arrive but nothing shows">
                <p>
                  Declare the key as a public metric in the app’s Profile tab. Keys are case-sensitive and must match
                  exactly.
                </p>
              </Problem>
            </div>
          </Section>
        </article>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests, types, lint, and prove the snippet is verbatim.**

```bash
pnpm test:unit -- app/docs/app-stats 2>&1 | tail -10   # PASS
sed -n '/^export const REPORT_USER_STAT_SNIPPET = `/,/^`$/p' modules/docs/report-user-stat-snippet.ts \
  | sed '1s/^export const REPORT_USER_STAT_SNIPPET = `//;$d' | sed 's/\\`/`/g' > /tmp/snippet.ts
diff /tmp/snippet.ts /home/f/projects/vetra-cloud-package-profiles/shared/report-user-stat.ts && echo verbatim   # verbatim
pnpm tsc 2>&1 | tail -5; pnpm lint 2>&1 | tail -5   # no errors
```

- [ ] **Step 5: Commit.**

```bash
git add modules/docs/report-user-stat-snippet.ts app/docs/app-stats/page.tsx app/docs/app-stats/__tests__/page.test.tsx
git commit -m "docs(apps): report app stats guide with the reportUserStat helper"
```

### Task 12: "Metrics" in the Profile tab

**Files:**
- Create: `modules/apps/lib/app-profile/metrics.ts`, `modules/apps/components/profile/metrics-editor.tsx`
- Modify: `modules/apps/lib/app-profile/form.ts`, `modules/apps/lib/app-profile/api.ts`, `modules/publisher/types.ts`, `modules/apps/components/profile/profile-tab.tsx`, `modules/publisher/__tests__/fixtures/licensing-contract.graphql`, `modules/apps/__tests__/app-profile-lib.test.ts` (one expectation)
- Test: `modules/apps/__tests__/app-metrics.test.ts`, `modules/apps/__tests__/metrics-editor.test.tsx`

**Interfaces:**
- Consumes: Task 6 (`UpdateAppProfileInput.metrics: [PublisherAppMetricInput!]`, refusals `INVALID_INPUT` + `field: "metrics"`); Task 4 (`AppProfile.metrics`); Phase 2 Tasks 9–11 (`form.ts`, `api.ts` `fetchAppProfile`/`FIELDS`, `ProfileForm` in `profile-tab.tsx`, `PublisherApiError.field`, `fieldForServer`).
- Produces:
  - `metrics.ts`: `METRIC_LIMITS = { metrics: 16, label: 40, unit: 16, description: 200 }`, `METRIC_KEY_RE`, `METRIC_AGGREGATIONS`, `type MetricAggregation`, `isMetricAggregation(s)`, `AGGREGATION_COPY: Record<MetricAggregation, { label; hint }>` (`Total | Highest | Average | Users`), `type AppMetricDraft { id, key, label, unit, description: string; aggregation; public: boolean }`, `type AppMetricChange { id, key, label: string; unit, description: string | null; aggregation; public }`, `metricDraftsFrom(metrics?)`, `newMetricDraft()`, `metricChanges(drafts)`, `metricsProblem(drafts): string | null`, `metricsChanged(a, b): boolean`.
  - `form.ts`: `AppProfileForm.metrics: AppMetricDraft[]`, `AppProfileField` adds `'metrics'`, `AppProfileChanges.metrics?: AppMetricChange[]` (the whole list when anything changed).
  - `api.ts`: `type RenownAppMetric`; `RenownAppProfile.metrics?: RenownAppMetric[]` (absent from Renown before Phase 3); `FIELDS` selects `metrics { … }`.
  - `types.ts`: `type PublisherAppMetricInput`; `UpdateAppProfileInput.metrics?: PublisherAppMetricInput[]`.
  - `<MetricsEditor metrics onChange error? />` with per-row controls labelled `Metric <n> label|key|unit|aggregation|public|description`, buttons `Move metric <n> up|down`, `Remove metric <n>`, `Add metric`.

- [ ] **Step 1: Write the failing tests and update the fixtures.**

Create `modules/apps/__tests__/app-metrics.test.ts` with exactly:

```ts
import { describe, expect, it } from 'vitest'
import type { RenownAppProfile } from '../lib/app-profile/api'
import { changedFields, fieldForServer, formFromProfile, formProblems } from '../lib/app-profile/form'
import {
  isMetricAggregation,
  metricChanges,
  metricDraftsFrom,
  metricsProblem,
  newMetricDraft,
  type AppMetricDraft,
} from '../lib/app-profile/metrics'

const PROFILE: RenownAppProfile = {
  appDid: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
  documentId: 'doc-9',
  name: 'Vault',
  tagline: null,
  logo: null,
  website: null,
  publisherDid: null,
  description: null,
  category: null,
  logoRef: null,
  coverRef: null,
  links: [],
  metrics: [{ id: 'm1', key: 'notes', label: 'Notes', unit: 'notes', description: null, aggregation: 'SUM', public: true }],
}
const draft = (extra: Partial<AppMetricDraft> = {}): AppMetricDraft => ({
  id: 'm2',
  key: 'streak',
  label: 'Best streak',
  unit: '',
  description: '',
  aggregation: 'MAX',
  public: false,
  ...extra,
})

describe('metric drafts', () => {
  it('load from the profile, or none for an older profile', () => {
    expect(formFromProfile(PROFILE).metrics).toEqual([
      { id: 'm1', key: 'notes', label: 'Notes', unit: 'notes', description: '', aggregation: 'SUM', public: true },
    ])
    expect(metricDraftsFrom(undefined)).toEqual([])
  })

  it('send the whole list, trimmed, only when something changed', () => {
    const base = formFromProfile(PROFILE)
    expect(changedFields(base, base)).toEqual({})
    expect(changedFields(base, { ...base, metrics: [{ ...base.metrics[0]!, label: ' Notes ' }] })).toEqual({})
    expect(
      changedFields(base, { ...base, metrics: [...base.metrics, draft({ label: ' Best streak ', unit: ' days ', description: ' ' })] }),
    ).toEqual({
      metrics: [
        { id: 'm1', key: 'notes', label: 'Notes', unit: 'notes', description: null, aggregation: 'SUM', public: true },
        { id: 'm2', key: 'streak', label: 'Best streak', unit: 'days', description: null, aggregation: 'MAX', public: false },
      ],
    })
    expect(changedFields(base, { ...base, metrics: [] })).toEqual({ metrics: [] })
    expect(metricChanges([draft({ public: false, unit: '0' })])[0]).toMatchObject({ public: false, unit: '0' })
  })

  it('names the first problem Renown would refuse', () => {
    expect(metricsProblem([draft()])).toBeNull()
    expect(metricsProblem(Array.from({ length: 17 }, (_, i) => draft({ id: `m${i}`, key: `k${i}` })))).toMatch(/At most 16/)
    expect(metricsProblem([draft({ key: '9lives' })])).toMatch(/Metric 1: the key/)
    expect(metricsProblem([draft(), draft({ id: 'm3' })])).toMatch(/Metric 2: the key “streak” is used twice/)
    expect(metricsProblem([draft({ label: '  ' })])).toMatch(/label/)
    expect(metricsProblem([draft({ label: 'l'.repeat(41) })])).toMatch(/label/)
    expect(metricsProblem([draft({ unit: 'u'.repeat(17) })])).toMatch(/unit/)
    expect(metricsProblem([draft({ description: 'd'.repeat(201) })])).toMatch(/description/)
    const base = formFromProfile(PROFILE)
    expect(formProblems({ ...base, metrics: [draft({ key: '' })] }).metrics).toMatch(/key/)
    expect(fieldForServer('metrics')).toBe('metrics')
  })

  it('new drafts are unique public totals', () => {
    const a = newMetricDraft()
    const b = newMetricDraft()
    expect(a.id).not.toBe(b.id)
    expect(a).toMatchObject({ key: '', label: '', aggregation: 'SUM', public: true })
    expect(isMetricAggregation('COUNT_USERS')).toBe(true)
    expect(isMetricAggregation('MEDIAN')).toBe(false)
  })
})
```

Create `modules/apps/__tests__/metrics-editor.test.tsx` with exactly:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { PublisherApiError } from '@/modules/publisher/graphql'
import type { RenownAppProfile } from '../lib/app-profile/api'

const DID = 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'
const NOTES = { id: 'm1', key: 'notes', label: 'Notes', unit: 'notes', description: null, aggregation: 'SUM' as const, public: true }
const STORED: RenownAppProfile = {
  appDid: DID,
  documentId: 'doc-9',
  name: 'Vault',
  tagline: null,
  logo: null,
  website: null,
  publisherDid: null,
  description: null,
  category: null,
  logoRef: null,
  coverRef: null,
  links: [],
  metrics: [NOTES],
}

let profile: { data: RenownAppProfile | null; isPending: boolean; error: Error | null; refetch: () => void }
const mutateAsync = vi.fn()

vi.mock('../hooks/use-app-profile', () => ({
  useAppProfile: () => profile,
  useUpdateAppProfile: () => ({ mutateAsync, isPending: false }),
  useRenownBearer: () => async () => 'bearer',
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { AppProfileTab } from '../components/profile/profile-tab'

const saveButton = () => screen.getByRole('button', { name: 'Save profile' }) as HTMLButtonElement
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

beforeEach(() => {
  cleanup()
  mutateAsync.mockReset()
  profile = { data: STORED, isPending: false, error: null, refetch: vi.fn() }
})

describe('Profile tab metrics', () => {
  it('lists the declared metrics and links to the guide', () => {
    render(<AppProfileTab appId="app-1" appName="Vault" appDid={DID} />)
    expect((screen.getByLabelText('Metric 1 key') as HTMLInputElement).value).toBe('notes')
    expect((screen.getByLabelText('Metric 1 aggregation') as HTMLSelectElement).value).toBe('SUM')
    expect(screen.getByRole('link', { name: 'How to report stats' }).getAttribute('href')).toBe('/docs/app-stats')
    expect(screen.getByText('1/16')).toBeTruthy()
  })

  it('declares a metric and saves only the metric list', async () => {
    mutateAsync.mockResolvedValue(true)
    render(<AppProfileTab appId="app-1" appName="Vault" appDid={DID} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add metric' }))
    type('Metric 2 label', 'Best streak')
    type('Metric 2 key', 'streak')
    type('Metric 2 unit', 'days')
    fireEvent.change(screen.getByLabelText('Metric 2 aggregation'), { target: { value: 'MAX' } })
    fireEvent.click(screen.getByRole('switch', { name: 'Metric 2 public' }))
    expect(saveButton().disabled).toBe(false)
    fireEvent.click(saveButton())
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))
    expect(mutateAsync.mock.calls[0]?.[0]).toEqual({
      metrics: [
        { ...NOTES },
        { id: expect.any(String), key: 'streak', label: 'Best streak', unit: 'days', description: null, aggregation: 'MAX', public: false },
      ],
    })
  })

  it('blocks saving a duplicate key and says why', () => {
    render(<AppProfileTab appId="app-1" appName="Vault" appDid={DID} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add metric' }))
    type('Metric 2 label', 'Again')
    type('Metric 2 key', 'notes')
    expect(screen.getByRole('alert').textContent).toMatch(/the key “notes” is used twice/)
    expect(saveButton().disabled).toBe(true)
  })

  it('reorders and removes metrics', async () => {
    mutateAsync.mockResolvedValue(true)
    render(<AppProfileTab appId="app-1" appName="Vault" appDid={DID} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove metric 1' }))
    fireEvent.click(saveButton())
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ metrics: [] }))
  })

  it('shows Renown refusing the list under Metrics', async () => {
    mutateAsync.mockRejectedValue(new PublisherApiError('INVALID_INPUT', 'Metric labels must be 1-40 characters', 200, 'metrics'))
    render(<AppProfileTab appId="app-1" appName="Vault" appDid={DID} />)
    type('Metric 1 description', 'Notes written in any vault')
    fireEvent.click(saveButton())
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Metric labels must be 1-40 characters'))
  })
})
```

In `modules/apps/__tests__/app-profile-lib.test.ts`, in the `formFromProfile(null)` expectation (test "starts from the stored profile, or empty"), replace:

```ts
      coverRef: null,
      links: [],
    })
```

with:

```ts
      coverRef: null,
      links: [],
      metrics: [],
    })
```

In `modules/publisher/__tests__/fixtures/licensing-contract.graphql` (the input Phase 2 Task 10 added) replace:

```graphql
  links: [PublisherAppLinkInput!]
}
```

with:

```graphql
  links: [PublisherAppLinkInput!]
  metrics: [PublisherAppMetricInput!]
}

enum PublisherMetricAggregation {
  SUM
  MAX
  AVG
  COUNT_USERS
}

input PublisherAppMetricInput {
  id: String!
  key: String!
  label: String!
  unit: String
  description: String
  aggregation: PublisherMetricAggregation!
  public: Boolean!
}
```

- [ ] **Step 2: Run them to see them fail.** `pnpm test:unit -- modules/apps/__tests__/app-metrics.test.ts modules/apps/__tests__/metrics-editor.test.tsx 2>&1 | tail -20` → FAIL (`Failed to resolve import "../lib/app-profile/metrics"`).

- [ ] **Step 3: Implement.**

Create `modules/apps/lib/app-profile/metrics.ts` with exactly:

```ts
// The Profile tab's metric definitions: what the app reports (key) and how
// Renown shows it. Mirrors renown-app-profile's rules, so problems show
// before saving.
import type { RenownAppMetric } from './api'

export const METRIC_LIMITS = { metrics: 16, label: 40, unit: 16, description: 200 } as const
export const METRIC_KEY_RE = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/
export const METRIC_AGGREGATIONS = ['SUM', 'MAX', 'AVG', 'COUNT_USERS'] as const
export type MetricAggregation = (typeof METRIC_AGGREGATIONS)[number]

export function isMetricAggregation(value: string): value is MetricAggregation {
  return (METRIC_AGGREGATIONS as readonly string[]).includes(value)
}

export const AGGREGATION_COPY: Record<MetricAggregation, { label: string; hint: string }> = {
  SUM: { label: 'Total', hint: 'Adds every user’s current value.' },
  MAX: { label: 'Highest', hint: 'The highest current value of any user.' },
  AVG: { label: 'Average', hint: 'The average of users’ current values.' },
  COUNT_USERS: { label: 'Users', hint: 'How many users have a value above zero.' },
}

export type AppMetricDraft = {
  id: string
  key: string
  label: string
  unit: string
  description: string
  aggregation: MetricAggregation
  public: boolean
}

/** One metric as updateAppProfile sends it; empty unit/description become null. */
export type AppMetricChange = {
  id: string
  key: string
  label: string
  unit: string | null
  description: string | null
  aggregation: MetricAggregation
  public: boolean
}

export function metricDraftsFrom(metrics: RenownAppMetric[] | undefined): AppMetricDraft[] {
  return (metrics ?? []).map((m) => ({
    id: m.id,
    key: m.key,
    label: m.label,
    unit: m.unit ?? '',
    description: m.description ?? '',
    aggregation: m.aggregation,
    public: m.public,
  }))
}

export function newMetricDraft(): AppMetricDraft {
  return { id: crypto.randomUUID(), key: '', label: '', unit: '', description: '', aggregation: 'SUM', public: true }
}

export function metricChanges(drafts: AppMetricDraft[]): AppMetricChange[] {
  return drafts.map((d) => ({
    id: d.id,
    key: d.key.trim(),
    label: d.label.trim(),
    unit: d.unit.trim() || null,
    description: d.description.trim() || null,
    aggregation: d.aggregation,
    public: d.public,
  }))
}

/** The first problem Renown would refuse, or null. */
export function metricsProblem(drafts: AppMetricDraft[]): string | null {
  if (drafts.length > METRIC_LIMITS.metrics) return `At most ${METRIC_LIMITS.metrics} metrics.`
  const keys = new Set<string>()
  for (const [index, metric] of metricChanges(drafts).entries()) {
    const n = index + 1
    if (!METRIC_KEY_RE.test(metric.key)) {
      return `Metric ${n}: the key starts with a letter and uses letters, digits and _ . : - (at most 64).`
    }
    if (keys.has(metric.key)) return `Metric ${n}: the key “${metric.key}” is used twice.`
    keys.add(metric.key)
    if (!metric.label || metric.label.length > METRIC_LIMITS.label) {
      return `Metric ${n}: the label needs 1–${METRIC_LIMITS.label} characters.`
    }
    if (metric.unit && metric.unit.length > METRIC_LIMITS.unit) {
      return `Metric ${n}: the unit is at most ${METRIC_LIMITS.unit} characters.`
    }
    if (metric.description && metric.description.length > METRIC_LIMITS.description) {
      return `Metric ${n}: the description is at most ${METRIC_LIMITS.description} characters.`
    }
  }
  return null
}

export function metricsChanged(initial: AppMetricDraft[], current: AppMetricDraft[]): boolean {
  return JSON.stringify(metricChanges(initial)) !== JSON.stringify(metricChanges(current))
}
```

In `modules/apps/lib/app-profile/api.ts` (Phase 2 Task 9):
1. Replace `export type RenownAppLink = { id: string; label: string; url: string }` with:

```ts
export type RenownAppLink = { id: string; label: string; url: string }

/** A publisher-defined metric (renown-stats AppMetric). */
export type RenownAppMetric = {
  id: string
  key: string
  label: string
  unit: string | null
  description: string | null
  aggregation: 'SUM' | 'MAX' | 'AVG' | 'COUNT_USERS'
  public: boolean
}
```

2. Replace:

```ts
  coverRef: string | null
  links: RenownAppLink[]
}
```

with:

```ts
  coverRef: string | null
  links: RenownAppLink[]
  /** Absent from Renown before identity hub phase 3. */
  metrics?: RenownAppMetric[]
}
```

3. Replace the `FIELDS` constant:

```ts
const FIELDS = `appDid documentId name tagline logo website publisherDid description category logoRef coverRef links { id label url }`
```

with:

```ts
const FIELDS = `appDid documentId name tagline logo website publisherDid description category logoRef coverRef links { id label url } metrics { id key label unit description aggregation public }`
```

In `modules/publisher/types.ts` (Phase 2 Task 10), replace:

```ts
  links?: PublisherAppLinkInput[]
}
```

with:

```ts
  links?: PublisherAppLinkInput[]
  /** The whole metric list; [] clears. */
  metrics?: PublisherAppMetricInput[]
}

export type PublisherAppMetricInput = {
  id: string
  key: string
  label: string
  unit: string | null
  description: string | null
  aggregation: 'SUM' | 'MAX' | 'AVG' | 'COUNT_USERS'
  public: boolean
}
```

In `modules/apps/lib/app-profile/form.ts` (Phase 2 Task 9):
1. Replace `import type { RenownAppProfile } from './api'` with:

```ts
import type { RenownAppProfile } from './api'
import {
  metricChanges,
  metricDraftsFrom,
  metricsChanged,
  metricsProblem,
  type AppMetricChange,
  type AppMetricDraft,
} from './metrics'
```

2. Replace the end of `AppProfileForm`:

```ts
  links: AppProfileLinkDraft[]
}
```

with:

```ts
  links: AppProfileLinkDraft[]
  metrics: AppMetricDraft[]
}
```

3. Replace `  | 'links'` (in `AppProfileField`) with:

```ts
  | 'links'
  | 'metrics'
```

4. Replace the end of `AppProfileChanges`:

```ts
  links?: AppProfileLinkDraft[]
}
```

with:

```ts
  links?: AppProfileLinkDraft[]
  metrics?: AppMetricChange[]
}
```

5. In `formFromProfile`, replace:

```ts
    links: (profile?.links ?? []).map(({ id, label, url }) => ({ id, label, url })),
  }
```

with:

```ts
    links: (profile?.links ?? []).map(({ id, label, url }) => ({ id, label, url })),
    metrics: metricDraftsFrom(profile?.metrics),
  }
```

6. In `formProblems`, replace:

```ts
    out.links = 'Every link needs an http(s) URL.'
  }
  return out
```

with:

```ts
    out.links = 'Every link needs an http(s) URL.'
  }
  const metrics = metricsProblem(form.metrics)
  if (metrics) out.metrics = metrics
  return out
```

7. In `changedFields`, replace:

```ts
  if (JSON.stringify(links) !== JSON.stringify(trimmedLinks(initial.links))) out.links = links
  return out
```

with:

```ts
  if (JSON.stringify(links) !== JSON.stringify(trimmedLinks(initial.links))) out.links = links
  if (metricsChanged(initial.metrics, current.metrics)) out.metrics = metricChanges(current.metrics)
  return out
```

8. In `fieldForServer`, replace:

```ts
    case 'links':
      return field
```

with:

```ts
    case 'links':
    case 'metrics':
      return field
```

Create `modules/apps/components/profile/metrics-editor.tsx` with exactly:

```tsx
'use client'

import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/modules/shared/components/ui/button'
import { Input } from '@/modules/shared/components/ui/input'
import { Switch } from '@/modules/shared/components/ui/switch'
import {
  AGGREGATION_COPY,
  isMetricAggregation,
  METRIC_AGGREGATIONS,
  METRIC_LIMITS,
  newMetricDraft,
  type AppMetricDraft,
} from '../../lib/app-profile/metrics'

/** Up to 16 metric definitions: label, key, unit, aggregation, public, description; add, reorder, remove. */
export function MetricsEditor({
  metrics,
  onChange,
  error,
}: {
  metrics: AppMetricDraft[]
  onChange: (metrics: AppMetricDraft[]) => void
  error?: string
}) {
  function update(index: number, patch: Partial<AppMetricDraft>) {
    onChange(metrics.map((metric, i) => (i === index ? { ...metric, ...patch } : metric)))
  }

  function move(index: number, by: -1 | 1) {
    const next = [...metrics]
    const [item] = next.splice(index, 1)
    if (!item) return
    next.splice(index + by, 0, item)
    onChange(next)
  }

  return (
    <div className="space-y-3">
      {metrics.length === 0 && (
        <p className="text-muted-foreground text-sm">
          No metrics yet. Declare what your app reports per user, for example notes written or a best streak.
        </p>
      )}
      {metrics.map((metric, index) => {
        const n = index + 1
        return (
          <fieldset key={metric.id} className="border-border space-y-3 rounded-xl border p-4">
            <legend className="sr-only">Metric {n}</legend>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_7rem]">
              <Input
                aria-label={`Metric ${n} label`}
                placeholder="Label, e.g. Notes written"
                value={metric.label}
                onChange={(e) => update(index, { label: e.target.value })}
              />
              <Input
                aria-label={`Metric ${n} key`}
                placeholder="Key, e.g. notes"
                className="font-mono"
                spellCheck={false}
                autoCapitalize="none"
                autoCorrect="off"
                value={metric.key}
                onChange={(e) => update(index, { key: e.target.value })}
              />
              <Input
                aria-label={`Metric ${n} unit`}
                placeholder="Unit"
                value={metric.unit}
                onChange={(e) => update(index, { unit: e.target.value })}
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <select
                aria-label={`Metric ${n} aggregation`}
                value={metric.aggregation}
                onChange={(e) => {
                  const value = e.target.value
                  if (isMetricAggregation(value)) update(index, { aggregation: value })
                }}
                className="border-input bg-background focus-visible:ring-ring h-9 rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none"
              >
                {METRIC_AGGREGATIONS.map((aggregation) => (
                  <option key={aggregation} value={aggregation}>
                    {AGGREGATION_COPY[aggregation].label}
                  </option>
                ))}
              </select>
              <span className="flex items-center gap-2 text-sm">
                <Switch
                  aria-label={`Metric ${n} public`}
                  checked={metric.public}
                  onCheckedChange={(checked) => update(index, { public: checked })}
                />
                Public
              </span>
              <p className="text-muted-foreground min-w-0 flex-1 text-xs">
                {AGGREGATION_COPY[metric.aggregation].hint} {metric.public ? 'Shown on Renown.' : 'Hidden on Renown.'}
              </p>
              <div className="flex shrink-0 gap-1">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`Move metric ${n} up`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`Move metric ${n} down`}
                  disabled={index === metrics.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`Remove metric ${n}`}
                  onClick={() => onChange(metrics.filter((_, i) => i !== index))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <Input
              aria-label={`Metric ${n} description`}
              placeholder="Description (optional)"
              value={metric.description}
              onChange={(e) => update(index, { description: e.target.value })}
            />
          </fieldset>
        )
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={metrics.length >= METRIC_LIMITS.metrics}
        onClick={() => onChange([...metrics, newMetricDraft()])}
      >
        <Plus className="h-3.5 w-3.5" />
        Add metric
      </Button>
      {error && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
```

In `modules/apps/components/profile/profile-tab.tsx` (Phase 2 Task 11):
1. Replace `import { useMemo, useState } from 'react'` with:

```tsx
import Link from 'next/link'
import { useMemo, useState } from 'react'
```

2. Replace `import { appPageUrl } from '../../lib/app-profile/renown'` with:

```tsx
import { METRIC_LIMITS } from '../../lib/app-profile/metrics'
import { appPageUrl } from '../../lib/app-profile/renown'
```

3. Replace `import { LinksEditor } from './links-editor'` with:

```tsx
import { LinksEditor } from './links-editor'
import { MetricsEditor } from './metrics-editor'
```

4. Replace:

```tsx
          <LinksEditor links={form.links} onChange={(links) => set('links', links)} error={errorFor('links')} />
        </section>
```

with:

```tsx
          <LinksEditor links={form.links} onChange={(links) => set('links', links)} error={errorFor('links')} />
        </section>

        <section className="space-y-3" aria-labelledby="profile-metrics-heading">
          <div className="flex items-baseline justify-between gap-3">
            <h3 id="profile-metrics-heading" className="text-sm font-medium">
              Metrics
            </h3>
            <span className="text-muted-foreground text-xs tabular-nums">
              {form.metrics.length}/{METRIC_LIMITS.metrics}
            </span>
          </div>
          <p className="text-muted-foreground text-xs">
            What your environments report for each user, and how Renown shows it on the app page and on users’
            profiles.{' '}
            <Link href="/docs/app-stats" className="text-primary hover:underline">
              How to report stats
            </Link>
          </p>
          <MetricsEditor metrics={form.metrics} onChange={(metrics) => set('metrics', metrics)} error={errorFor('metrics')} />
        </section>
```

- [ ] **Step 4: Run tests, types, lint.** `pnpm test:unit -- modules/apps modules/publisher 2>&1 | tail -20` → PASS (Phase 2's profile-tab and contract tests stay green). `pnpm tsc 2>&1 | tail -5`, `pnpm lint 2>&1 | tail -5` → no errors.

- [ ] **Step 5: Look at it.** `NEXT_PUBLIC_RENOWN_URL=https://renown-staging.vetra.io NEXT_PUBLIC_RENOWN_SWITCHBOARD_URL=https://switchboard.renown-staging.vetra.io/graphql pnpm dev`, sign in, open an app → **Profile** → Metrics: light and dark, 375 px and desktop; rows stack on mobile, the select and switch stay on one line with the hint wrapping below, nothing scrolls horizontally. (Saving needs Task 14's staging release.)

- [ ] **Step 6: Commit.**

```bash
git add modules/apps/lib/app-profile/metrics.ts modules/apps/lib/app-profile/form.ts modules/apps/lib/app-profile/api.ts modules/publisher/types.ts modules/apps/components/profile/metrics-editor.tsx modules/apps/components/profile/profile-tab.tsx modules/publisher/__tests__/fixtures/licensing-contract.graphql modules/apps/__tests__/app-profile-lib.test.ts modules/apps/__tests__/app-metrics.test.ts modules/apps/__tests__/metrics-editor.test.tsx
git commit -m "feat(apps): declare app metrics in the Profile tab"
```

### Task 13: Compact stat tiles on the app Overview

**Files:**
- Create: `modules/apps/lib/app-stats/api.ts`, `modules/apps/lib/app-stats/format.ts`, `modules/apps/hooks/use-app-stats.ts`, `modules/apps/components/stats/app-stats-card.tsx`
- Modify: `modules/apps/components/app-overview.tsx`
- Test: `modules/apps/__tests__/app-stats-lib.test.ts`, `modules/apps/__tests__/app-stats-card.test.tsx`

**Interfaces:**
- Consumes: Task 5 `appStats`; Phase 2 `renownStatsEndpoint`, `appPageUrl` (`lib/app-profile/renown.ts`), the Overview with `<AppProfileCard … />`; Task 12 `AGGREGATION_COPY`.
- Produces: `type AppStats`, `type AppMetricStat` (no contributors), `fetchAppStats(appDid, fetchImpl?) → AppStats | null` (throws `Error` with Renown's message); `formatStatValue` (verbatim copy of renown.id `utils/stat-format.ts`'s); `appStatsKey(appDid)`, `useAppStats(appDid)`; `<AppStatsCard appDid />` (nothing without an identity; tiles carry `data-metric`).

- [ ] **Step 1: Write the failing tests.**

Create `modules/apps/__tests__/app-stats-lib.test.ts` with exactly:

```ts
import { describe, expect, it, vi } from 'vitest'
import { fetchAppStats } from '../lib/app-stats/api'
import { formatStatValue } from '../lib/app-stats/format'

const answer = (body: unknown, status = 200) =>
  vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify(body), { status }))

describe('app stats reads', () => {
  it('asks Renown for an app’s public stats', async () => {
    const stats = { appDid: 'did:key:z1', activeUsers30d: 1, totalUsers: 2, updatedAt: null, metrics: [] }
    const fetchImpl = answer({ data: { appStats: stats } })
    expect(await fetchAppStats('did:key:z1', fetchImpl as unknown as typeof fetch)).toEqual(stats)
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe('https://switchboard.renown.vetra.io/graphql/renown-stats')
    const body = JSON.parse(init.body as string) as { query: string; variables: unknown }
    expect(body.query).toContain('appStats(appDid: $appDid)')
    expect(body.variables).toEqual({ appDid: 'did:key:z1' })
  })

  it('is null for an app Renown does not know, and throws Renown’s message', async () => {
    expect(await fetchAppStats('did:key:z1', answer({ data: { appStats: null } }) as unknown as typeof fetch)).toBeNull()
    await expect(
      fetchAppStats('x', answer({ errors: [{ message: 'appDid must be a did:key DID' }] }) as unknown as typeof fetch),
    ).rejects.toThrow('appDid must be a did:key DID')
    await expect(fetchAppStats('x', answer({}, 502) as unknown as typeof fetch)).rejects.toThrow('Renown answered 502')
  })

  it('formats values like renown.id', () => {
    expect(formatStatValue(1234)).toBe('1,234')
    expect(formatStatValue(12500)).toBe('12.5K')
    expect(formatStatValue(0.125)).toBe('0.13')
  })
})
```

Create `modules/apps/__tests__/app-stats-card.test.tsx` with exactly:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import React from 'react'
import type { AppStats } from '../lib/app-stats/api'

const DID = 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'
const STATS: AppStats = {
  appDid: DID,
  activeUsers30d: 5,
  totalUsers: 12,
  updatedAt: '2026-10-09T08:00:00.000Z',
  metrics: [
    { key: 'notes', label: 'Notes written', unit: 'notes', aggregation: 'SUM', value: 1234, users: 9 },
    { key: 'streak', label: 'Best streak', unit: null, aggregation: 'MAX', value: 42, users: 3 },
  ],
}
let state: { data: AppStats | null | undefined; isPending: boolean; error: Error | null }

vi.mock('../hooks/use-app-stats', () => ({ useAppStats: () => state }))

import { AppStatsCard } from '../components/stats/app-stats-card'

beforeEach(() => {
  cleanup()
  state = { data: STATS, isPending: false, error: null }
})

describe('AppStatsCard', () => {
  it('renders nothing without a Renown identity', () => {
    const { container } = render(<AppStatsCard appDid={null} />)
    expect(container.innerHTML).toBe('')
  })

  it('shows active users and a tile per public metric', () => {
    render(<AppStatsCard appDid={DID} />)
    expect(screen.getByRole('heading', { name: 'Stats' })).toBeTruthy()
    expect(screen.getByText('of 12 users')).toBeTruthy()
    const notes = document.querySelector('[data-metric="notes"]')?.textContent ?? ''
    for (const text of ['1,234', 'notes', 'Notes written', 'Total']) expect(notes).toContain(text)
    expect(document.querySelector('[data-metric="streak"]')?.textContent).toContain('Highest')
    expect(screen.getByRole('link', { name: /View on Renown/ }).getAttribute('href')).toBe(`https://www.renown.id/app/${DID}`)
  })

  it('points to the guide while there are no stats', () => {
    state = { data: null, isPending: false, error: null }
    render(<AppStatsCard appDid={DID} />)
    expect(screen.getByText('No stats yet')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'How to report stats' }).getAttribute('href')).toBe('/docs/app-stats')
    expect(screen.queryByRole('link', { name: /View on Renown/ })).toBeNull()
  })

  it('says so when Renown cannot be reached', () => {
    state = { data: undefined, isPending: false, error: new Error('down') }
    render(<AppStatsCard appDid={DID} />)
    expect(screen.getByText('Stats could not be loaded from Renown right now.')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run them to see them fail.** `pnpm test:unit -- modules/apps/__tests__/app-stats 2>&1 | tail -15` → FAIL (`Failed to resolve import "../lib/app-stats/api"`).

- [ ] **Step 3: Implement.**

Create `modules/apps/lib/app-stats/api.ts` with exactly:

```ts
import { renownStatsEndpoint } from '../app-profile/renown'

export type MetricAggregation = 'SUM' | 'MAX' | 'AVG' | 'COUNT_USERS'

/** One public metric's headline (renown-stats AppMetricStat, without contributors). */
export type AppMetricStat = {
  key: string
  label: string
  unit: string | null
  aggregation: MetricAggregation
  value: number
  users: number
}

export type AppStats = {
  appDid: string
  activeUsers30d: number
  totalUsers: number
  metrics: AppMetricStat[]
  updatedAt: string | null
}

const QUERY = `query AppStats($appDid: String!) { appStats(appDid: $appDid) { appDid activeUsers30d totalUsers updatedAt metrics { key label unit aggregation value users } } }`

type Body = { data?: { appStats?: AppStats | null } | null; errors?: { message?: string }[] }

/** The app's public stats on Renown, or null when Renown knows nothing of it yet. Public; no token. */
export async function fetchAppStats(appDid: string, fetchImpl: typeof fetch = fetch): Promise<AppStats | null> {
  const res = await fetchImpl(renownStatsEndpoint(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: QUERY, variables: { appDid } }),
  })
  const body = (await res.json().catch(() => null)) as Body | null
  const error = body?.errors?.[0]
  if (error || !res.ok) throw new Error(error?.message ?? `Renown answered ${res.status}`)
  return body?.data?.appStats ?? null
}
```

Create `modules/apps/lib/app-stats/format.ts` with exactly:

```ts
// Verbatim copy of renown.id utils/stat-format.ts formatStatValue (the app page shows the same numbers).

/** 1,234 · 12.5K · 1.2M · 0.13 — compact from 10,000 on. Same output on server and client. */
export function formatStatValue(value: number): string {
  const options: Intl.NumberFormatOptions =
    Math.abs(value) >= 10_000 ? { notation: 'compact', maximumFractionDigits: 1 } : { maximumFractionDigits: 2 }
  return new Intl.NumberFormat('en-US', options).format(value)
}
```

Create `modules/apps/hooks/use-app-stats.ts` with exactly:

```ts
'use client'

import { useQuery } from '@tanstack/react-query'
import { fetchAppStats, type AppStats } from '../lib/app-stats/api'

export const appStatsKey = (appDid: string) => ['renown-app-stats', appDid] as const

/** The app's public stats on Renown (null when it has none yet). Public read, no token. */
export function useAppStats(appDid: string | null | undefined) {
  return useQuery<AppStats | null>({
    queryKey: appStatsKey(appDid ?? ''),
    queryFn: () => fetchAppStats(appDid ?? ''),
    enabled: !!appDid,
    staleTime: 60_000,
    retry: 1,
  })
}
```

Create `modules/apps/components/stats/app-stats-card.tsx` with exactly:

```tsx
'use client'

import { ArrowUpRight, BarChart3 } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/modules/shared/components/ui/button'
import { Skeleton } from '@/modules/shared/components/ui/skeleton'
import { useAppStats } from '../../hooks/use-app-stats'
import { AGGREGATION_COPY } from '../../lib/app-profile/metrics'
import { appPageUrl } from '../../lib/app-profile/renown'
import { formatStatValue } from '../../lib/app-stats/format'

/** Tiles shown at most: active users plus seven metrics fill two rows of four. */
const MAX_METRIC_TILES = 7

function Tile({
  caption,
  value,
  unit,
  label,
  metricKey,
}: {
  caption: string
  value: number
  unit: string | null
  label: string
  metricKey?: string
}) {
  return (
    <div className="border-border bg-card min-w-0 rounded-xl border p-4" data-metric={metricKey}>
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{caption}</p>
      <p className="mt-1 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tabular-nums">{formatStatValue(value)}</span>
        {unit && <span className="text-muted-foreground truncate text-sm">{unit}</span>}
      </p>
      <p className="text-muted-foreground mt-0.5 truncate text-sm">{label}</p>
    </div>
  )
}

/** The Overview's "Stats" section: the app's public Renown stats as compact tiles. */
export function AppStatsCard({ appDid }: { appDid: string | null | undefined }) {
  const stats = useAppStats(appDid)
  if (!appDid) return null
  const data = stats.data
  const shown = data && (data.metrics.length > 0 || data.totalUsers > 0) ? data : null
  return (
    <section className="space-y-4" aria-labelledby="app-stats-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="app-stats-heading" className="text-lg font-semibold">
          Stats
        </h2>
        {shown && (
          <Button size="sm" variant="ghost" asChild>
            <a href={appPageUrl(appDid)} target="_blank" rel="noopener noreferrer">
              View on Renown
              <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          </Button>
        )}
      </div>
      {stats.isPending ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : stats.error ? (
        <p className="text-muted-foreground text-sm">Stats could not be loaded from Renown right now.</p>
      ) : shown ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile
            caption="Active · 30 days"
            value={shown.activeUsers30d}
            unit={null}
            label={`of ${formatStatValue(shown.totalUsers)} users`}
          />
          {shown.metrics.slice(0, MAX_METRIC_TILES).map((m) => (
            <Tile
              key={m.key}
              metricKey={m.key}
              caption={AGGREGATION_COPY[m.aggregation].label}
              value={m.value}
              unit={m.unit}
              label={m.label}
            />
          ))}
        </div>
      ) : (
        <div className="border-border bg-card flex flex-col items-start gap-3 rounded-2xl border border-dashed p-6">
          <BarChart3 className="text-primary h-5 w-5" aria-hidden />
          <div className="space-y-1">
            <p className="font-medium">No stats yet</p>
            <p className="text-muted-foreground text-sm">
              Declare metrics in the Profile tab, then report users’ values from your environments.
            </p>
          </div>
          <Button size="sm" variant="outline" asChild>
            <Link href="/docs/app-stats">How to report stats</Link>
          </Button>
        </div>
      )}
    </section>
  )
}
```

In `modules/apps/components/app-overview.tsx` (as Phase 2 Task 11 left it):
1. Replace `import { AppProfileCard } from './profile/app-profile-card'` with:

```tsx
import { AppProfileCard } from './profile/app-profile-card'
import { AppStatsCard } from './stats/app-stats-card'
```

2. Replace:

```tsx
      <AppProfileCard appDid={app.identityDid} appName={app.name} onEdit={onEditProfile} />
```

with:

```tsx
      <AppProfileCard appDid={app.identityDid} appName={app.name} onEdit={onEditProfile} />
      <AppStatsCard appDid={app.identityDid} />
```

- [ ] **Step 4: Run tests, types, lint, build.** `pnpm test:unit 2>&1 | tail -20` → PASS (all suites). `pnpm tsc 2>&1 | tail -5`, `pnpm lint 2>&1 | tail -5` → no errors. `pnpm build 2>&1 | tail -8` → succeeds (includes `/docs/app-stats`).

- [ ] **Step 5: Look at it.** Same dev command as Task 12 Step 5; Overview of an app with an identity: light/dark, 375 px (2 tiles per row) and desktop (4 per row); the empty state's button opens `/docs/app-stats`; the docs page itself at 375 px has no horizontal scroll (code blocks scroll inside their panel).

- [ ] **Step 6: Commit.**

```bash
git add modules/apps/lib/app-stats/api.ts modules/apps/lib/app-stats/format.ts modules/apps/hooks/use-app-stats.ts modules/apps/components/stats/app-stats-card.tsx modules/apps/components/app-overview.tsx modules/apps/__tests__/app-stats-lib.test.ts modules/apps/__tests__/app-stats-card.test.tsx
git commit -m "feat(apps): Renown stat tiles on the app overview"
```

## Part E — Rollout and proof (controller-run)

Order in each environment: renown-package (metrics, aggregates, `appStats`) → vetra-cloud-package (metric relay, studio identity) → renown.id (pages) → vetra.io (Metrics section, overview, docs). Preconditions: Phase 2 is live on staging **and** prod (its Task 14 done); Tasks 1–13 committed on their branches with all checks green. Never print a secret: checks below only say `set`/`MISSING` or `match`/`DIFFER`. No hosting environment change is needed: both Vetra tenants already set `RENOWN_STATS_URL`, `VETRA_LICENSING_URL`, `OPENBAO_ADDR` and the registration token (verified in Phase 2 Task 12 Step 2).

### Task 14: Release Phase 3 to staging *(controller-run: pushes, workflows, hosting)*

- [ ] **Step 1: renown-package → `staging` and release.**

```bash
cd /home/f/projects/renown-package-hub
git fetch origin
git switch -C staging origin/staging
git merge --no-ff feat/identity-hub -m "chore: merge identity hub phase 3 (app stats) into staging"
pnpm install --frozen-lockfile && pnpm tsc && pnpm lint && pnpm exec vitest run --coverage 2>&1 | tail -15 && pnpm build 2>&1 | tail -3
git push git@github.com:powerhouse-inc/renown-package.git staging
gh workflow run sync-and-publish.yml -R powerhouse-inc/renown-package --ref staging -f channel=staging -f sync=false
sleep 5; RUN=$(gh run list -R powerhouse-inc/renown-package --workflow sync-and-publish.yml -L 1 --json databaseId -q '.[0].databaseId')
gh run watch -R powerhouse-inc/renown-package "$RUN" --exit-status
git switch feat/identity-hub
```

Expected: a `v1.(n+1).0-staging.N` release, images pushed, and the deploy job's commit touching only `tenants/renown-staging/powerhouse-values.yaml`.

- [ ] **Step 2: Confirm the Renown staging switchboard serves Phase 3 and ran the backfill.**

```bash
git -C /home/f/projects/powerhouse-k8s-hosting pull --ff-only
kubectl -n renown-staging rollout status deploy/switchboard --timeout=10m
SB=https://switchboard.renown-staging.vetra.io
curl -s "$SB/graphql/renown-stats" -H 'content-type: application/json' \
  -d '{"query":"{ appStats(appDid: \"did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK\") { totalUsers } }"}'   # {"data":{"appStats":null}}
curl -s "$SB/graphql/renown-stats" -H 'content-type: application/json' \
  -d '{"query":"{ appProfiles(limit: 2) { items { appDid metrics { key } } } }"}' | head -c 300; echo   # data, every item has a metrics array
kubectl -n renown-staging logs deploy/switchboard --since=15m | grep -E "\[renown-stats\]" | tail -5   # "backfilled N metric values …" or nothing; never "metric backfill … failed"
PG=$(kubectl -n renown-staging get pods -l cnpg.io/cluster -o name | head -1)
DB=$(kubectl -n renown-staging get cluster -o jsonpath='{.items[0].spec.bootstrap.initdb.database}')
NS=$(kubectl -n renown-staging exec "$PG" -c postgres -- psql -d "$DB" -tAc "select nspname from pg_namespace where nspname like '%renown-stats%'")
kubectl -n renown-staging exec "$PG" -c postgres -- psql -d "$DB" -tAc "select name from \"$NS\".renown_stats_jobs; select count(*) from \"$NS\".app_metric_values"
```

Expected: the job row `app-metric-values-backfill-v1` and a count equal to the number of stats in existing user-stats documents (0 is fine on a fresh staging). If the job row is missing and the log says "retried on the next start", restart once (`kubectl -n renown-staging rollout restart deploy/switchboard`) and re-check; a second failure goes back to Task 3 with the logged document id.

- [ ] **Step 3: vetra-cloud-package → `staging`, then pin it on the staging tenant.**

```bash
cd /home/f/projects/vetra-cloud-package-profiles
git fetch origin
git switch --detach origin/staging
git merge --no-ff feat/identity-hub-profiles -m "chore: merge identity hub phase 3 (metric relay, studio identity, stats helper) into staging"
```

If `package.json` conflicts only on `"version"`, keep the **staging** side's version line and `git add package.json && git commit --no-edit`; any other conflict: stop and resolve by hand. Then:

```bash
pnpm install --frozen-lockfile && pnpm tsc && pnpm lint && pnpm exec vitest run 2>&1 | tail -15
git push git@github.com:powerhouse-inc/vetra-cloud-package.git HEAD:staging
sleep 5; RUN=$(gh run list -R powerhouse-inc/vetra-cloud-package --workflow sync-and-publish.yml --branch staging -L 1 --json databaseId -q '.[0].databaseId')
gh run watch -R powerhouse-inc/vetra-cloud-package "$RUN" --exit-status
git fetch -q origin staging && VER=$(git show origin/staging:package.json | jq -r .version) && echo "$VER"
git switch feat/identity-hub-profiles
cd /home/f/projects/powerhouse-k8s-hosting
git pull --ff-only
sed -i -E "s#(@powerhousedao/vetra-cloud-package@)[0-9][^\",]*#\1${VER}#g" tenants/staging/powerhouse-values.yaml
git diff --stat   # exactly 2 lines in tenants/staging/powerhouse-values.yaml (switchboard + connect PH_REGISTRY_PACKAGES)
git add tenants/staging/powerhouse-values.yaml
git commit -m "chore(staging): vetra-cloud-package ${VER} (identity hub phase 3)"
git push
```

Wait for ArgoCD to roll the staging switchboard (`kubectl get deploy -A | grep -i switchboard` → the vetra staging one; `kubectl -n <ns> rollout status deploy/<name> --timeout=10m`), then:

```bash
curl -s https://switchboard.staging.vetra.io/graphql -H 'content-type: application/json' \
  -d '{"query":"mutation { vetraPublisher { updateAppProfile(input: { appId: \"x\", metrics: [] }) } }"}' | grep -o '"code":"[A-Z_]*"'   # UNAUTHENTICATED (metrics is accepted by the schema)
```

- [ ] **Step 4: renown.id → `deploy/staging`, then pin the image.**

```bash
cd /home/f/projects/renown-hub
git fetch origin
git switch -C deploy/staging origin/deploy/staging
git merge --no-ff feat/identity-hub -m "chore: merge identity hub phase 3 (app stats) into deploy/staging"
git push git@github.com:powerhouse-inc/renown.git deploy/staging
SHA7=$(git rev-parse --short=7 HEAD)
sleep 5; RUN=$(gh run list -R powerhouse-inc/renown --workflow semantic-release.yml --branch deploy/staging -L 1 --json databaseId -q '.[0].databaseId')
gh run watch -R powerhouse-inc/renown "$RUN" --exit-status
git switch feat/identity-hub
cd /home/f/projects/powerhouse-k8s-hosting
git pull --ff-only
sed -i -E "s/^(    tag: )staging-[0-9a-f]{7}$/\1staging-${SHA7}/" tenants/renown-staging/powerhouse-values.yaml
git diff --stat   # exactly one line: app.image.tag in tenants/renown-staging/powerhouse-values.yaml
git add tenants/renown-staging/powerhouse-values.yaml
git commit -m "chore(renown-staging): renown-app staging-${SHA7} (identity hub phase 3)"
git push
```

- [ ] **Step 5: vetra.io → `staging` (its workflow bumps the staging tenant itself).**

```bash
cd /home/f/projects/vetra.io-hub
git fetch origin
git switch -C staging origin/staging
git merge --no-ff feat/identity-hub -m "chore: merge identity hub phase 3 (app stats) into staging"
pnpm install --frozen-lockfile && pnpm tsc && pnpm lint && pnpm test:unit 2>&1 | tail -10
git push git@github.com:powerhouse-inc/vetra.to.git staging
sleep 5; RUN=$(gh run list -R powerhouse-inc/vetra.to --workflow publish-docker-image.yml --branch staging -L 1 --json databaseId -q '.[0].databaseId')
gh run watch -R powerhouse-inc/vetra.to "$RUN" --exit-status
git switch feat/identity-hub
SHA7=$(git -C /home/f/projects/vetra.io-hub rev-parse --short=7 origin/staging)
git -C /home/f/projects/powerhouse-k8s-hosting pull --ff-only
grep -A3 "repository: cr.vetra.io/vetra/vetra-to" /home/f/projects/powerhouse-k8s-hosting/tenants/staging/powerhouse-values.yaml   # tag: staging-${SHA7}
curl -s -o /dev/null -w "%{http_code}\n" https://staging.vetra.io/docs/app-stats   # 200
```

### Task 15: Make it work on staging — the end-to-end proof *(controller-run, a person with a wallet)*

The path: licensed DEDICATED environment (`VETRA_REPORTING_TOKEN`, `VETRA_LICENSING_URL` in its tenant secret) → `vetraLicensing.reportUserStat` on `switchboard.staging.vetra.io` → relay (`issueAppStatsToken` + `reportUserStat` on `switchboard.renown-staging.vetra.io`) → `appStats` / pages. Use the app created in Phase 2 Task 13 Step 1 (its identity is registered on **renown-staging**; older staging apps carry prod identities and are refused by Renown staging).

- [ ] **Step 1: A licensed environment for yourself.** On `https://staging.vetra.io`, signed in with the wallet that owns that app: app → **Templates**: add a template with the app's package; **Plans**: add a plan using it and activate it; **Holders**: issue a grant of that plan to your own wallet address. Within a few minutes the holder row shows a READY environment (the provisioning keeper creates one DEDICATED environment per licence chain). Note: `APP_DID` (the app's identity, Settings), `USER_DID=did:pkh:eip155:1:<your address>`, the environment's subdomain.

- [ ] **Step 2: Declare the metric.** App → **Profile** → **Metrics** → Add metric: label `Notes written`, key `notes`, unit `notes`, aggregation Total, Public on → Save profile → toast "Profile saved. It is live on Renown." Then:

```bash
curl -s https://switchboard.renown-staging.vetra.io/graphql/renown-stats -H 'content-type: application/json' \
  -d "{\"query\":\"{ appProfile(appDid: \\\"$APP_DID\\\") { metrics { key label aggregation public } } }\"}"   # notes, SUM, public true
```

- [ ] **Step 3: Find the environment and check the token reached it (names only).**

```bash
VS_NS=<vetra staging switchboard namespace>; VS_DEPLOY=<its deployment>   # from: kubectl get deploy -A | grep -i switchboard
kubectl -n "$VS_NS" logs "deploy/$VS_DEPLOY" --since=60m \
  | grep -E "\[licensing\] (reporting token|reporting tokens are not issued|all reporting tokens|[0-9]+ reporting token|user stat from environment|renown stats for app|user stats are not relayed)" | tail -20
ENV_NS=$(kubectl get ns -o name | grep -i "<subdomain>" | head -1 | cut -d/ -f2); echo "$ENV_NS"
kubectl -n "$ENV_NS" get deploy                                    # note the switchboard deployment: ENV_DEPLOY
SECRET=$(kubectl -n "$ENV_NS" get secret -o name | grep -- '-secrets$' | head -1)
kubectl -n "$ENV_NS" get "$SECRET" -o json | jq -r '.data | keys[]' | grep -E '^VETRA_(REPORTING_TOKEN|LICENSING_URL)$'   # both names
```

- [ ] **Step 4: Run the proof.**

```bash
cd /home/f/projects/vetra-cloud-package-profiles
node --experimental-strip-types scripts/smoke/app-stats-proof.mts \
  --namespace "$ENV_NS" --deployment "$ENV_DEPLOY" \
  --app-did "$APP_DID" --user "$USER_DID" --metric notes 2>&1 | tail -12
```

Expected, in order: `ok the environment has …`, `ok Vetra queued notes=<n> …`, `ok Renown userStats has notes=<n>`, `ok notes is declared public ("Notes written")`, `ok appStats notes = <n>`, `ok https://renown-staging.vetra.io/app/<did> shows notes`, `ok https://renown-staging.vetra.io/profile/<address> shows notes=<n>`, `PROVEN app stats flow end to end`. If the switchboard container is not the default one, add `--container <name>` (from `kubectl -n "$ENV_NS" get deploy "$ENV_DEPLOY" -o jsonpath='{.spec.template.spec.containers[*].name}'`).

- [ ] **Step 5: When a check fails, fix by the first matching row, then re-run Step 4.**

| Symptom | Cause | Fix |
|---|---|---|
| Vetra log `reporting tokens are not issued: VETRA_LICENSING_URL is unset` (or `… secrets service (OPENBAO_ADDR) …`) | hosting env | add the variable to the switchboard `env` in `tenants/staging/powerhouse-values.yaml`, push, wait for the rollout |
| Vetra log `N reporting token(s) pending …` | per-tick budget (`LICENSING_TOKENS_PER_TICK`, default 5; each issue restarts a running environment once) | wait one or two handler ticks |
| no `reporting token` line for the environment, no secret keys | the environment is not a licence-chain environment | only licensed DEDICATED environments get tokens (Ruling 7): redo Step 1 through a grant |
| issue logged, but the secret lacks the keys | the secrets controller does not reconcile this tenant (its values have no `tenantSecretsController`: the environment has no Switchboard service) | enable the Switchboard service on the environment; check the controller's logs (`kubectl get deploy -A \| grep -i secrets-controller`) |
| secret has the keys, script step 1 says MISSING | the pod predates the secret (Reloader missed it) | `kubectl -n "$ENV_NS" rollout restart deploy/"$ENV_DEPLOY"` |
| script: `UNAUTHENTICATED … unknown reporting token` | the pod's token is not the one whose hash Vetra recorded | restart the pod; if it persists, delete that environment's row in Vetra's `environment_reporting_tokens` (licensing namespace, `where environment_id = '<id>'`) so the next tick issues a fresh token, then restart |
| script: `reportUserStat:false`, Vetra log `… not relayed: the user is not the environment's holder` | wrong `--user` | pass the licence holder's `did:pkh` |
| `… not relayed: app <id> has no usable Renown identity` | the apps row has no `identity_did`, or status not ACTIVE/DISCONNECTED (studio: Task 7 not deployed) | authorize the identity on the app's Overview; for the studio app confirm Task 7 is in the pinned version |
| `… chain head … is <status>` / `… ended …` | the licence is not ACTIVE | issue a new grant |
| Vetra log `renown stats for app <did> not delivered (FORBIDDEN)` | renown-staging refuses to mint (`issueAppStatsToken`) or accept: identity registered only on prod Renown, or the owner's delegation lapsed | use the Phase 2 Task 13 app, or re-authorize the identity on renown-staging.vetra.io; reports for that app resume after the 5-minute back-off |
| Vetra log `… not delivered (HTTP_401)` or `(UNAUTHENTICATED)` | stats audience mismatch on renown-staging | `RENOWN_STATS_AUDIENCE` must be identical (or unset) on every renown-staging switchboard replica; fix in `tenants/renown-staging/powerhouse-values.yaml` |
| Vetra log `user stats are not relayed to Renown: …` | `RENOWN_STATS_URL` or the registration token unset on Vetra staging | hosting env (Phase 2 Task 12 Step 2 check) |
| script: `notes is not declared as a public metric` | Step 2 not saved, or key mismatch (case-sensitive) | redo Step 2 |
| script times out on the app or profile page while `appStats` passed | renown.id not on the Phase 3 image, or the 30 s page cache | confirm the `staging-<sha>` pin from Task 14 Step 4; re-run |

Any fix that needs code goes back to the owning task (with a failing test first) and through Task 14 again.

- [ ] **Step 6: Look at the result.** `https://renown-staging.vetra.io/app/<APP_DID>`: Stats heading, "Active · 30 days" tile, the Notes written tile with the reported value + `notes`, Top contributors with your avatar and handle linking to `/@<handle>`. `https://renown-staging.vetra.io/@<handle>`: Stats section with the app's logo and name (→ app page) and `Notes written`. `https://staging.vetra.io` → app → Overview: Stats tiles; Profile → Metrics shows the metric. Check light/dark and a 375 px window on all three. Toggle the metric to non-public → save → within a minute it disappears from both Renown pages and the overview (`appStats` omits it; `userStats` omits it).

- [ ] **Step 7: The studio relay (Task 7), if a studio environment exists on staging.** `kubectl -n "$VS_NS" logs "deploy/$VS_DEPLOY" --since=60m | grep "app 5f0e7a1c-3b2d-4c8e-9a6f-0d1e2f3a4b5c has no usable Renown identity"` → no lines after the Task 14 rollout. A later `renown stats for app <studio did> not delivered (FORBIDDEN)` means the studio identity is not a registered workload identity on renown-staging: record it as follow-up F3, do not block.

- [ ] **Step 8: Record** the proof output (it prints no secrets) and the browser findings in the hand-off note.

### Task 16: Promote to production *(controller-run)*

- [ ] **Step 1: renown-package → `main`, release `latest`.**

```bash
cd /home/f/projects/renown-package-hub
git fetch origin
git switch -C main origin/main
git merge --no-ff feat/identity-hub -m "chore: merge identity hub phase 3 (app stats)"
pnpm install --frozen-lockfile && pnpm tsc && pnpm lint && pnpm exec vitest run --coverage 2>&1 | tail -15 && pnpm build 2>&1 | tail -3
git push git@github.com:powerhouse-inc/renown-package.git main
gh workflow run sync-and-publish.yml -R powerhouse-inc/renown-package --ref main -f channel=latest -f sync=false
sleep 5; RUN=$(gh run list -R powerhouse-inc/renown-package --workflow sync-and-publish.yml -L 1 --json databaseId -q '.[0].databaseId')
gh run watch -R powerhouse-inc/renown-package "$RUN" --exit-status
git switch feat/identity-hub
```

Expected: release `v1.(n+1).0`; the deploy commit touches only `tenants/renown/powerhouse-values.yaml`; Task 14 Step 2's checks against `https://switchboard.renown.vetra.io` and namespace `renown` pass (prod has real user-stats documents: the backfill count must equal their stats — spot-check one user: `userStats(userDid)` lists as many `notes`-like entries as `app_metric_values` rows for that `user_did`).

- [ ] **Step 2: vetra-cloud-package → `main`, then pin it on the prod tenant.**

```bash
cd /home/f/projects/vetra-cloud-package-profiles
git fetch origin
git switch --detach origin/main
git merge --no-ff feat/identity-hub-profiles -m "chore: merge identity hub phase 3 (metric relay, studio identity, stats helper)"
pnpm install --frozen-lockfile && pnpm tsc && pnpm lint && pnpm exec vitest run 2>&1 | tail -15
git push git@github.com:powerhouse-inc/vetra-cloud-package.git HEAD:main
sleep 5; RUN=$(gh run list -R powerhouse-inc/vetra-cloud-package --workflow sync-and-publish.yml --branch main -L 1 --json databaseId -q '.[0].databaseId')
gh run watch -R powerhouse-inc/vetra-cloud-package "$RUN" --exit-status
git fetch -q origin main && VER=$(git show origin/main:package.json | jq -r .version) && echo "$VER"
git switch feat/identity-hub-profiles
cd /home/f/projects/powerhouse-k8s-hosting
git pull --ff-only
sed -i -E "s#(@powerhousedao/vetra-cloud-package@)[0-9][^\",]*#\1${VER}#g" tenants/vetra/powerhouse-values.yaml
git diff --stat   # exactly 2 lines in tenants/vetra/powerhouse-values.yaml
git add tenants/vetra/powerhouse-values.yaml
git commit -m "chore(vetra): vetra-cloud-package ${VER} (identity hub phase 3)"
git push
```

After the rollout: `curl -s https://switchboard.vetra.io/graphql -H 'content-type: application/json' -d '{"query":"mutation { vetraPublisher { updateAppProfile(input: { appId: \"x\", metrics: [] }) } }"}' | grep -o '"code":"[A-Z_]*"'` → `UNAUTHENTICATED`.

- [ ] **Step 3: renown.id → `main`.**

```bash
cd /home/f/projects/renown-hub
git fetch origin
git switch -C main origin/main
git merge --no-ff feat/identity-hub -m "chore: merge identity hub phase 3 (app stats)"
git push git@github.com:powerhouse-inc/renown.git main
sleep 5; RUN=$(gh run list -R powerhouse-inc/renown --workflow semantic-release.yml --branch main -L 1 --json databaseId -q '.[0].databaseId')
gh run watch -R powerhouse-inc/renown "$RUN" --exit-status
VERSION=$(git fetch --tags -q && git describe --tags --abbrev=0 origin/main)
git switch feat/identity-hub
cd /home/f/projects/powerhouse-k8s-hosting
git pull --ff-only
sed -i -E "s/^(    tag: )1\.[0-9]+\.[0-9]+$/\1${VERSION#v}/" tenants/renown/powerhouse-values.yaml
git diff --stat   # exactly one line: app.image.tag in tenants/renown/powerhouse-values.yaml
git add tenants/renown/powerhouse-values.yaml
git commit -m "chore(renown): renown-app ${VERSION#v} (identity hub phase 3)"
git push
```

Vercel deploys `www.renown.id` from `main` on its own.

- [ ] **Step 4: vetra.io → `main` (its workflow bumps `tenants/vetra`).**

```bash
cd /home/f/projects/vetra.io-hub
git fetch origin
git switch -C main origin/main
git merge --no-ff feat/identity-hub -m "chore: merge identity hub phase 3 (app stats)"
pnpm install --frozen-lockfile && pnpm tsc && pnpm lint && pnpm test:unit 2>&1 | tail -10
git push git@github.com:powerhouse-inc/vetra.to.git main
sleep 5; RUN=$(gh run list -R powerhouse-inc/vetra.to --workflow publish-docker-image.yml --branch main -L 1 --json databaseId -q '.[0].databaseId')
gh run watch -R powerhouse-inc/vetra.to "$RUN" --exit-status
git switch feat/identity-hub
git -C /home/f/projects/powerhouse-k8s-hosting pull --ff-only
grep -A3 "repository: cr.vetra.io/vetra/vetra-to" /home/f/projects/powerhouse-k8s-hosting/tenants/vetra/powerhouse-values.yaml   # tag: main-<sha7>
curl -s -o /dev/null -w "%{http_code}\n" https://vetra.io/docs/app-stats   # 200
```

`main` and `staging` of vetra.io now both carry Phase 3.

- [ ] **Step 5: Prod verification.** For an app you own on `https://vetra.io` with an identity: declare a public metric in Profile → Metrics; Overview shows the Stats section (empty state linking to `/docs/app-stats` until values arrive). If a licensed DEDICATED environment with you as holder exists on prod, run Task 15 Step 4 against it with `--renown-switchboard https://switchboard.renown.vetra.io --renown-web https://www.renown.id` (Vercel caches pages ~30 s; the script polls). Otherwise check `appStats` for an app that already has backfilled values (any app with prior `reportUserStat` traffic) and its `https://www.renown.id/app/<did>` page. Check light/dark and 375 px. Record the results.

## Follow-ups (not in this plan)

- **F1 (Phase 1/2):** the unreferenced-upload sweep is unchanged by this phase.
- **F2 (Ruling 7):** reporting from an app's own production environment for any of its users (a reporting token for production environments and an any-user relay rule for them); needs its own trust review.
- **F3:** if Task 15 Step 7 finds the studio identity unregistered on renown-staging/prod Renown, register it (or document studio stats as unavailable).
- **F4:** historical series (per-day snapshots of `appStats`) for trend charts; this phase keeps current values only.
- **F5:** remove the unused worktree `/home/f/projects/vetra-cloud-package-hub` (`feat/identity-hub-stats`) — Ruling 9.

## Self-review (done while writing)

- **Spec coverage:** metric definitions + ops + ≤ 16 + unique key (Task 1); edited from the Profile tab through the Phase 2 write path, full replace (Tasks 4, 6, 12); `app_metric_values` upserted with each accepted report (Task 4), derived SUM/MAX/AVG/COUNT_USERS, active 30 d, total users (Tasks 2, 5); one-time idempotent backfill (Task 3); `appStats` public, public metrics only, top 5 with handle/avatar via the Phase 1 read model (Task 5); `userStats` enriched (Task 5); helper (Task 8), docs section (Task 11), staging proof incl. pages (Tasks 8, 15); token-to-environment verification and fixes (Tasks 7, 15); app page tiles/active users/top contributors (Task 9), profile Stats grouped by app (Task 10), vetra.io overview tiles (Task 13); tests: reducers ≥ 95 % with every error code (Task 1), PGlite store/resolver tests for aggregation math, public filtering, backfill idempotency, concurrent upserts (Tasks 2–5), e2e for pages (Tasks 9, 10), component tests (Tasks 11–13); rollout staging → prod for every repo, vetra.io on both branches (Tasks 14, 16).
- **Placeholders:** none; the only fill-ins are runtime values the controller reads from the cluster or vetra.io (namespaces, app DID, holder DID), each with the command that yields it.
- **Type consistency:** `AppMetric`/`AppMetricInput`/`toAppMetric`/`toMetricsPatch`/`metricActions` (Task 4) are what Task 5 consumes; `MetricValue`/`MetricAggregate`/`AppActivity`/`recordMetricValues`/`metricAggregates`/`appActivity`/`userStatsDocumentsPage`/`jobDone`/`markJobDone` (Task 2) match Tasks 3–5; GraphQL field names in Task 5 match `services/app-stats.ts` (Task 9), `lib/app-stats/api.ts` (Task 13) and the proof script (Task 8); `data-metric`/`data-value`/`data-app-did` markers (Tasks 9, 10) match the proof script; `PublisherAppMetricInput`/`PublisherMetricAggregation` match between Vetra's schema, the contract doc and vetra.io's fixture (Tasks 6, 12).
