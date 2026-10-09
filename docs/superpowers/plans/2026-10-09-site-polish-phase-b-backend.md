# renown.id Site Polish — Phase B Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the three public reads the polished renown.id needs — `appProfiles(category)`, `appProfileCategories` and `renownNetworkStats` — to the `renown-stats` subgraph of renown-package.

**Architecture:** The app-profile category lives in each `powerhouse/renown-app-profile` document; it is mirrored into a new nullable `category` column of the subgraph's own index table `app_profile_documents` (healed on every `upsertAppProfile`, filled once for existing profiles by a startup backfill job), so filtering and counting are single SQL queries. `renownNetworkStats` combines one stats-index query (apps, 30-day active users from `app_metric_values`, the same table and window `appStats.activeUsers30d` uses) with two read-model queries (`renown_user`, `renown_credential`) made through `RenownUserProcessor.query` / `RenownCredentialProcessor.query` exactly like `lookups.ts` already does, and caches the answer in-process for 300 s.

**Tech Stack:** TypeScript (nodenext, strict), Powerhouse reactor package 6.2.3 (`@powerhousedao/reactor-api` `BaseSubgraph`), Kysely 0.28 on Postgres (PGlite in tests), graphql-tag SDL, vitest, oxlint (type-aware).

**Spec:** `docs/superpowers/specs/2026-10-09-renown-site-polish-design.md` — section "Backend (renown-package, `subgraphs/renown-stats`)" and the renown-package line of "Testing".

## Interfaces produced

Exact SDL added to `subgraphs/renown-stats/schema.ts` (served on the supergraph `<switchboard>/graphql` and on `<switchboard>/graphql/renown-stats`). All three fields are public (no auth), like `appProfiles`.

```graphql
"A category used by app profiles, and how many carry it (case-insensitively)."
type AppProfileCategory {
  "The smallest spelling (byte order) among the profiles that carry it."
  category: String!
  count: Int!
}

"Network-wide counts, recomputed at most every 300 s."
type RenownNetworkStats {
  "Distinct wallets (lower-cased) with a Renown profile."
  identities: Int!
  "App profiles."
  apps: Int!
  "Unrevoked credentials with no expiry or an expiry in the future (by credential id)."
  activeCredentials: Int!
  "Distinct users any app reported a stat for in the last 30 days."
  activeUsers30d: Int!
  "ISO time the counts were computed."
  updatedAt: String!
}

type Query {
  # existing fields unchanged, plus / changed:
  """
  Every app profile, newest first. limit 1-50 (default 20). category: only
  profiles whose category equals it case-insensitively (trimmed); blank or
  absent = all. Pass the same category with after.
  """
  appProfiles(limit: Int, after: String, category: String): AppProfilePage!
  "Non-empty categories of app profiles: count desc, then name."
  appProfileCategories: [AppProfileCategory!]!
  "Network-wide counts; SERVICE_UNAVAILABLE when a read model cannot be read."
  renownNetworkStats: RenownNetworkStats!
}
```

Error contract for website consumers (GraphQL `errors[].extensions.code`):

| Field | Code | When |
| --- | --- | --- |
| `appProfiles` | `BAD_USER_INPUT` | `limit` outside 1–50 / not an integer, or `after` not a cursor (unchanged) |
| all three | `SERVICE_NOT_CONFIGURED` | the subgraph's namespace failed to set up (existing convention) |
| `appProfileCategories`, `renownNetworkStats` | `SERVICE_UNAVAILABLE` (message "Stats are temporarily unavailable") | a database read failed; never cached |

Example queries the website will send:

```graphql
query Apps($category: String, $after: String) {
  appProfiles(limit: 24, category: $category, after: $after) {
    items { appDid documentId name tagline category logoRef coverRef logo }
    next
  }
  appProfileCategories { category count }
}
query Pulse { renownNetworkStats { identities apps activeCredentials activeUsers30d updatedAt } }
```

`appProfileCategories[].category` is the label to show *and* the value to pass back as `appProfiles(category:)` (matching is case-insensitive, so any spelling works).

## Planner rulings (binding for this plan)

1. **Where the category is indexed.** It is not in the index today (only in the document state). A nullable `category text` column is added to `app_profile_documents` (`ALTER TABLE … ADD COLUMN IF NOT EXISTS`), written after every save from the saved document (same heal block as the image index), and back-filled once at startup by job `app-profile-category-backfill-v1` in `renown_stats_jobs`.
2. **Case.** Filter = `lower(category) = lower(<trimmed arg>)`. Categories are grouped by `lower(category)`, so "DeFi" and "defi" are one chip; its label is `min(category collate "C")`. Order: `count desc`, then `lower(category) collate "C"` — deterministic whatever the database locale.
3. **activeCredentials** counts `distinct credential_id` of rows with `revoked = false and (expiration_date is null or expiration_date > now)`: several documents can carry one VC (copies written before writes were closed, see `subgraphs/renown-auth/lookups.ts` `findCredentialDocs`). An expiry exactly equal to now is expired.
4. **identities** = `count(distinct lower(eth_address))` over `renown_user` rows whose `eth_address` is non-null and non-empty.
5. **apps** = every row of `app_profile_documents` (profiles whose document is momentarily unreadable still count). **activeUsers30d** = `count(distinct user_did)` of `app_metric_values` with `updated_at >= now - ACTIVE_WINDOW_MS` (30 days) over all apps — the source `appStats.activeUsers30d` uses (`KyselyStatsIndex.appActivity`).
6. **Errors.** Missing index → `SERVICE_NOT_CONFIGURED` (as every other field); any storage failure in the new reads → the existing `unavailable()` helper (`SERVICE_UNAVAILABLE`, "Stats are temporarily unavailable", reason logged server-side). `appProfiles` keeps its current error behaviour.
7. **Cache.** Per subgraph instance (per replica), 300 s from the computation time (`updatedAt`); concurrent cold requests share one computation; failures are never cached.
8. **Filter edge cases.** A category longer than 40 characters (the model's maximum) simply matches nothing — no error. Blank / whitespace / null / absent = no filter.
9. **Smoke script** is read-only, so it does not take `--allow-prod`.

## Global Constraints

- Powerhouse packages stay at 6.2.3; no new dependencies (runtime or dev).
- No `Co-Authored-By` trailers in commits.
- Staging first, then prod. Backend (renown-package) ships before the website that needs it.
- All three new reads are public reads (same exposure as `appProfiles`).
- `renownNetworkStats` is cached in-process for 300 s; a storage failure maps to `SERVICE_UNAVAILABLE`.
- Read-model tables of other namespaces are read only via `RenownUserProcessor.query<RenownUserDB>("renown-user", db)` and `RenownCredentialProcessor.query<RenownCredentialDB>("renown-credential", db)` (they resolve the hashed Postgres schema through `relationalDb.queryNamespace`, which only exposes `selectFrom` / `selectNoFrom` / `with`). Never write raw SQL that names a table: `withSchema` qualifies only builder table references, never table names inside `sql\`…\``.
- The stats index (`renown-stats` namespace) is the full namespaced Kysely the subgraph got from `createNamespace` at setup; only `store/kysely.ts` touches it.
- Never edit `gen/` folders. Relative imports carry `.js`.
- After every task: `npm run tsc` (no output), `npm run lint` (no errors and no new warnings in touched files), `npx vitest run subgraphs/renown-stats` green.

## Review Focus

1. Profiles saved before this deploy have no indexed category: until the backfill ran, `/apps` chips would be empty and filters would return nothing — Task 2 backfill tests pin "copies once, pages, skips after" and "unreadable document leaves the job open and the next run finishes".
2. Publishers type the same category in different cases ("DeFi" / "defi" / "DEFI"): one chip with the summed count, and the filter returns all of them — Task 1 and Task 3 tests.
3. A visitor-supplied `?category=%20games%20` or an empty `?category=`: trimmed / treated as no filter rather than "no apps" — Task 3 `it.each` over `undefined, null, "", "   "` and the `"  games "` case.
4. A tenant where a read-model namespace is missing or the DB blips: homepage SSR must get `SERVICE_UNAVAILABLE` (not a raw SQL error, not a cached failure) — Task 4 "does not cache the failure" test.
5. The homepage and `/apps` SSR firing several cold requests at once: one computation, not N parallel triple queries — Task 4 "shares one computation" test; and a credential expiring exactly now is not counted — Task 4 first test (`expiration: NOW`).

## File Structure

| File | Responsibility |
| --- | --- |
| `subgraphs/renown-stats/store/migrations.ts` (modify) | adds `app_profile_documents.category` |
| `subgraphs/renown-stats/store/types.ts` (modify) | row type, `AppCategoryCount`, `NetworkActivity`, new `StatsIndex` methods |
| `subgraphs/renown-stats/store/kysely.ts` (modify) | filtered page, `setAppCategory`, `appProfileCategories`, `networkActivity` |
| `subgraphs/renown-stats/core/category-backfill.ts` (create) | one-time copy of existing categories into the index |
| `subgraphs/renown-stats/index.ts` (modify) | runs the category backfill after the metric backfill at setup |
| `subgraphs/renown-stats/lookups.ts` (modify) | `identityCount`, `activeCredentialCount` over the read models |
| `subgraphs/renown-stats/resolvers.ts` (modify) | category heal on save; `appProfiles(category)`, `appProfileCategories`, `renownNetworkStats` + cache |
| `subgraphs/renown-stats/schema.ts` (modify) | SDL above |
| `subgraphs/renown-stats/tests/*.ts` | `store-catalog`, `category-index`, `app-catalog`, `network-stats` (new); `harness`, `subgraph` (modified) |
| `scripts/smoke/network-stats.ts` (create) + `scripts/smoke/README.md` | read-only rollout smoke |
| `subgraphs/renown-stats/README.md` (modify) | documents the new reads |

---

### Task 1: Stats index — category column, filtered page, category counts, network activity

**Files:**
- Modify: `subgraphs/renown-stats/store/migrations.ts` (end of `migrate`)
- Modify: `subgraphs/renown-stats/store/types.ts` (`AppProfileDocumentRow`, new types before `AppActivity`, `StatsIndex`)
- Modify: `subgraphs/renown-stats/store/kysely.ts` (imports, `appProfilesPage`, three new methods after it)
- Test: `subgraphs/renown-stats/tests/store-catalog.test.ts` (create)

**Interfaces:**
- Consumes: existing `KyselyStatsIndex`, `migrate`, `StatsDB`.
- Produces (in `store/types.ts`, implemented by `KyselyStatsIndex`):
  - `appProfilesPage(limit: number, after?: AppProfileCursor, category?: string): Promise<AppProfileListEntry[]>`
  - `setAppCategory(appDid: string, category: string | null): Promise<void>` — trims; blank stores null; unknown DID is a no-op
  - `appProfileCategories(): Promise<AppCategoryCount[]>` with `interface AppCategoryCount { category: string; count: number }`
  - `networkActivity(since: Date): Promise<NetworkActivity>` with `interface NetworkActivity { apps: number; activeUsers: number }`

- [ ] **Step 1: Write the failing test** — create `subgraphs/renown-stats/tests/store-catalog.test.ts`:

```ts
import { PGlite } from "@electric-sql/pglite";
import { Kysely, sql } from "kysely";
import { PGliteDialect } from "kysely-pglite-dialect";
import { afterAll, describe, expect, it } from "vitest";
import { KyselyStatsIndex } from "../store/kysely.js";
import { migrate } from "../store/migrations.js";
import type { StatsDB } from "../store/types.js";

const opened: Kysely<StatsDB>[] = [];
afterAll(async () => {
  await Promise.all(opened.map((db) => db.destroy()));
});

async function makeIndex(): Promise<{ index: KyselyStatsIndex; db: Kysely<StatsDB> }> {
  const root = new Kysely<StatsDB>({ dialect: new PGliteDialect(new PGlite()) });
  opened.push(root);
  await sql`create schema "renown-stats"`.execute(root);
  const db = root.withSchema("renown-stats");
  await migrate(db);
  await migrate(db); // idempotent, also for the added category column
  return { index: new KyselyStatsIndex(db), db };
}

const at = (minute: number) => new Date(Date.UTC(2026, 9, 9, 12, minute));

/** Claims `appDid` (created at minute `minute`) and records `category`. */
async function profile(index: KyselyStatsIndex, appDid: string, minute: number, category: string | null) {
  await index.claimAppProfile({ appDid, documentId: `doc-${appDid}`, publisherAddress: "0xabc" }, at(minute));
  await index.setAppCategory(appDid, category);
}

describe("KyselyStatsIndex app catalog", () => {
  it("adds the category column to a table created before it existed", async () => {
    const root = new Kysely<any>({ dialect: new PGliteDialect(new PGlite()) });
    await sql`create schema "renown-stats"`.execute(root);
    const db = root.withSchema("renown-stats");
    await db.schema
      .createTable("app_profile_documents")
      .addColumn("app_did", "text", (col) => col.primaryKey())
      .addColumn("document_id", "text", (col) => col.notNull())
      .addColumn("publisher_address", "text", (col) => col.notNull())
      .addColumn("created_at", "timestamptz", (col) => col.notNull())
      .execute();
    await db
      .insertInto("app_profile_documents")
      .values({ app_did: "did:key:zOld", document_id: "doc-old", publisher_address: "0xabc", created_at: at(0) })
      .execute();
    await migrate(db);
    const rows = await db.selectFrom("app_profile_documents").select(["app_did", "category"]).execute();
    expect(rows).toEqual([{ app_did: "did:key:zOld", category: null }]);
    await root.destroy();
  });

  it("filters the newest-first listing by category, case-insensitively, across pages", async () => {
    const { index } = await makeIndex();
    await profile(index, "did:key:zA", 1, "DeFi");
    await profile(index, "did:key:zB", 2, "Games");
    await profile(index, "did:key:zC", 3, "defi");
    await profile(index, "did:key:zD", 4, null);
    await profile(index, "did:key:zE", 5, "DEFI");

    const first = await index.appProfilesPage(2, undefined, "dEfI");
    expect(first.map((e) => e.appDid)).toEqual(["did:key:zE", "did:key:zC"]);
    const last = first.at(-1)!;
    const second = await index.appProfilesPage(2, { createdAt: last.createdAt, appDid: last.appDid }, "defi");
    expect(second.map((e) => e.appDid)).toEqual(["did:key:zA"]);
    expect((await index.appProfilesPage(10, undefined, "games")).map((e) => e.appDid)).toEqual(["did:key:zB"]);
    expect(await index.appProfilesPage(10, undefined, "nothing")).toEqual([]);
    expect(await index.appProfilesPage(10)).toHaveLength(5);
  });

  it("records, replaces and clears a profile's category", async () => {
    const { index, db } = await makeIndex();
    await profile(index, "did:key:zA", 1, "Tools");
    await index.setAppCategory("did:key:zA", "Games");
    await index.setAppCategory("did:key:zUnknown", "Games"); // no profile: nothing to update
    const read = () => db.selectFrom("app_profile_documents").select(["app_did", "category"]).execute();
    expect(await read()).toEqual([{ app_did: "did:key:zA", category: "Games" }]);
    await index.setAppCategory("did:key:zA", null);
    expect(await read()).toEqual([{ app_did: "did:key:zA", category: null }]);
  });

  it("counts non-empty categories case-insensitively, by count desc then name", async () => {
    const { index } = await makeIndex();
    await profile(index, "did:key:z1", 1, "Games");
    await profile(index, "did:key:z2", 2, "tools");
    await profile(index, "did:key:z3", 3, "DeFi");
    await profile(index, "did:key:z4", 4, "defi");
    await profile(index, "did:key:z5", 5, "Analytics");
    await profile(index, "did:key:z6", 6, null);
    await profile(index, "did:key:z7", 7, "");
    expect(await index.appProfileCategories()).toEqual([
      // "DeFi" < "defi" in byte order: the label is the smallest spelling.
      { category: "DeFi", count: 2 },
      { category: "Analytics", count: 1 },
      { category: "Games", count: 1 },
      { category: "tools", count: 1 },
    ]);
  });

  it("returns no categories for an empty index", async () => {
    const { index } = await makeIndex();
    expect(await index.appProfileCategories()).toEqual([]);
  });

  it("counts app profiles and distinct users reporting to any app since a time", async () => {
    const { index } = await makeIndex();
    expect(await index.networkActivity(at(0))).toEqual({ apps: 0, activeUsers: 0 });
    await profile(index, "did:key:z1", 1, null);
    await profile(index, "did:key:z2", 2, "Games");
    await index.recordMetricValues([
      { appDid: "did:key:z1", metric: "m", userDid: "u1", value: 1, updatedAt: at(10) },
      { appDid: "did:key:z2", metric: "m", userDid: "u1", value: 1, updatedAt: at(11) },
      { appDid: "did:key:zNoProfile", metric: "m", userDid: "u2", value: 1, updatedAt: at(10) },
      { appDid: "did:key:z1", metric: "m", userDid: "u3", value: 1, updatedAt: at(1) },
    ]);
    // u3 last reported before the window; u1 counts once across two apps.
    expect(await index.networkActivity(at(10))).toEqual({ apps: 2, activeUsers: 2 });
    expect(await index.networkActivity(at(0))).toEqual({ apps: 2, activeUsers: 3 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run subgraphs/renown-stats/tests/store-catalog.test.ts`
Expected: FAIL — 6 failed, e.g. `TypeError: index.setAppCategory is not a function`, and the migration test fails on the missing `category` column.

- [ ] **Step 3: Add the column** — in `subgraphs/renown-stats/store/migrations.ts`, append inside `migrate`, after the `renown_stats_jobs` table:

```ts

  // Site polish: each profile's category (trimmed, null when none), copied
  // from the document on every save, for the category filter and counts.
  await db.schema
    .alterTable("app_profile_documents")
    .addColumn("category", "text", (col) => col.ifNotExists())
    .execute();
```

- [ ] **Step 4: Extend the types** — in `subgraphs/renown-stats/store/types.ts`:

Add to `AppProfileDocumentRow` after `created_at: Timestamp;`:

```ts
  /** The profile's category as last saved (trimmed); null when none. Absent on insert. */
  category?: string | null;
```

Insert directly above `export interface AppActivity {`:

```ts
/** A non-empty category and how many profiles carry it (case-insensitively). */
export interface AppCategoryCount {
  /** The smallest spelling (byte order) among the profiles that carry it. */
  category: string;
  count: number;
}

/** Network-wide counts from the stats index. */
export interface NetworkActivity {
  /** App profiles. */
  apps: number;
  /** Distinct users with any stat reported to any app since the given time. */
  activeUsers: number;
}

```

In `interface StatsIndex`, replace

```ts
  /** Up to `limit` profiles, newest first, strictly after `after`. */
  appProfilesPage(limit: number, after?: AppProfileCursor): Promise<AppProfileListEntry[]>;
```

with

```ts
  /**
   * Up to `limit` profiles, newest first, strictly after `after`; with
   * `category`, only profiles whose category equals it case-insensitively.
   */
  appProfilesPage(limit: number, after?: AppProfileCursor, category?: string): Promise<AppProfileListEntry[]>;
  /** Records a profile's category ("" or blank stores null); a DID without a profile is ignored. */
  setAppCategory(appDid: string, category: string | null): Promise<void>;
  /** Non-empty categories with their profile counts: count desc, then name. */
  appProfileCategories(): Promise<AppCategoryCount[]>;
  /** App profiles, and distinct users reporting to any app since `since`. */
  networkActivity(since: Date): Promise<NetworkActivity>;
```

- [ ] **Step 5: Implement in `subgraphs/renown-stats/store/kysely.ts`**

In the `import type { … } from "./types.js";` list add `AppCategoryCount,` (after `AppActivity,`) and `NetworkActivity,` (after `MetricValue,`).

Change the signature of `appProfilesPage` to

```ts
  async appProfilesPage(limit: number, after?: AppProfileCursor, category?: string): Promise<AppProfileListEntry[]> {
```

and, inside it, between the `if (after) { … }` block and `const rows = await query.execute();`, insert:

```ts
    if (category !== undefined) {
      query = query.where((eb) => eb(eb.fn("lower", ["category"]), "=", eb.fn("lower", [eb.val(category)])));
    }
```

Then add these methods directly after `appProfilesPage` (before `recordMetricValues`):

```ts
  async setAppCategory(appDid: string, category: string | null): Promise<void> {
    await this.db
      .updateTable("app_profile_documents")
      .set({ category: category?.trim() || null })
      .where("app_did", "=", appDid)
      .execute();
  }

  async appProfileCategories(): Promise<AppCategoryCount[]> {
    // Grouped case-insensitively (the filter is); "C" collation keeps the
    // label and the order the same whatever the database's locale.
    const rows = await this.db
      .selectFrom("app_profile_documents")
      .select([
        sql<string>`min(category collate "C")`.as("label"),
        sql<number>`count(*)::int`.as("count"),
      ])
      .where("category", "is not", null)
      .where("category", "<>", "")
      .groupBy(sql`lower(category)`)
      .orderBy(sql`count(*)`, "desc")
      .orderBy(sql`lower(category) collate "C"`, "asc")
      .execute();
    return rows.map((row) => ({ category: row.label, count: Number(row.count) }));
  }

  async networkActivity(since: Date): Promise<NetworkActivity> {
    const apps = await this.db
      .selectFrom("app_profile_documents")
      .select(sql<number>`count(*)::int`.as("apps"))
      .executeTakeFirstOrThrow();
    const active = await this.db
      .selectFrom("app_metric_values")
      .select(sql<number>`count(distinct user_did)::int`.as("users"))
      .where("updated_at", ">=", since)
      .executeTakeFirstOrThrow();
    return { apps: Number(apps.apps), activeUsers: Number(active.users) };
  }
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run subgraphs/renown-stats`
Expected: PASS (store-catalog 6/6; all earlier suites unchanged).

Run: `npm run tsc && npm run lint 2>&1 | grep -E " error |renown-stats"` — expected: no output.

- [ ] **Step 7: Commit**

```bash
git add subgraphs/renown-stats/store subgraphs/renown-stats/tests/store-catalog.test.ts
git commit -m "feat(stats): index app-profile categories and network activity"
```

---

### Task 2: Keep the category index current — heal on save, one-time backfill at setup

**Files:**
- Create: `subgraphs/renown-stats/core/category-backfill.ts`
- Modify: `subgraphs/renown-stats/resolvers.ts` (`upsertAppProfile` heal block, ~lines 952-971 before this plan)
- Modify: `subgraphs/renown-stats/index.ts` (imports; `onSetup` backfill chain)
- Modify: `subgraphs/renown-stats/tests/subgraph.test.ts` ("runs the one-time backfill at setup and records it")
- Test: `subgraphs/renown-stats/tests/category-index.test.ts` (create)

**Interfaces:**
- Consumes: `StatsIndex.setAppCategory`, `StatsIndex.appProfilesPage(limit, after)` (Task 1), `jobDone` / `markJobDone`.
- Produces:
  - `export const CATEGORY_BACKFILL_JOB = "app-profile-category-backfill-v1"`
  - `export async function backfillAppCategories(deps: CategoryBackfillDeps): Promise<CategoryBackfillResult>` with `CategoryBackfillDeps { index: StatsIndex; reactorClient: Pick<IReactorClient, "get">; now: () => Date; logger?: Pick<Console, "info" | "warn">; pageSize?: number }` and `CategoryBackfillResult { status: "done" | "skipped" | "incomplete"; documents: number; failed: number }`.
  - Every successful `upsertAppProfile` leaves `app_profile_documents.category` equal to the saved document's category.

- [ ] **Step 1: Write the failing test** — create `subgraphs/renown-stats/tests/category-index.test.ts`:

```ts
import type { IReactorClient } from "@powerhousedao/reactor";
import type { PHDocument } from "document-model";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  actions as profileActions,
  reducer as profileReducer,
  utils as profileUtils,
} from "../../../document-models/renown-app-profile/index.js";
import { backfillAppCategories, CATEGORY_BACKFILL_JOB } from "../core/category-backfill.js";
import { harnessResolvers, openHarness, registerApp, resetHarness, STATS_NS, type Harness } from "./harness.js";

const APP = "did:key:zDnaerDaTF5BXEavCrfRZEk316dpbLsfPDZ3WJ5hRTPFU2169";
const APP_2 = "did:key:z6MkjchhfUsD6mmvni8mCdXHw216Xrm9bQe2mBH1P5RDjVJG";
const APP_3 = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";
const now = () => new Date("2026-10-09T00:00:00Z");
const quiet = { info: vi.fn(), warn: vi.fn() };

let h: Harness;
beforeAll(async () => {
  h = await openHarness();
});
afterAll(async () => {
  await h.root.destroy();
});
beforeEach(async () => {
  await resetHarness(h);
  for (const appDid of [APP, APP_2, APP_3]) await registerApp(h, appDid);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const categories = (appDid?: string) => {
  let query = h.root.withSchema(STATS_NS).selectFrom("app_profile_documents").select(["app_did", "category"]);
  if (appDid) query = query.where("app_did", "=", appDid);
  return query.orderBy("app_did").execute();
};

describe("upsertAppProfile keeps the category index", () => {
  it("records the saved category, keeps it when absent and clears it with an empty string", async () => {
    const r = harnessResolvers(h);
    await r.upsert({ appDid: APP, name: "Vault", category: "  DeFi  " });
    expect(await categories(APP)).toEqual([{ app_did: APP, category: "DeFi" }]);
    await r.upsert({ appDid: APP, tagline: "no category argument" });
    expect(await categories(APP)).toEqual([{ app_did: APP, category: "DeFi" }]);
    await r.upsert({ appDid: APP, category: "" });
    expect(await categories(APP)).toEqual([{ app_did: APP, category: null }]);
  });
});

/** A profile document with `category` (none when null), as upsertAppProfile leaves it. */
function profileDoc(appDid: string, category: string | null): PHDocument {
  let doc = profileReducer(profileUtils.createDocument(), profileActions.setAppDid({ appDid }));
  if (category !== null) doc = profileReducer(doc, profileActions.setProfile({ category }));
  return doc as unknown as PHDocument;
}

function reactorWith(docs: Record<string, PHDocument>) {
  const get = vi.fn((id: string) =>
    id in docs ? Promise.resolve(docs[id]) : Promise.reject(new Error(`no document ${id}`)),
  );
  return { get, client: { get } as unknown as Pick<IReactorClient, "get"> };
}

describe("backfillAppCategories", () => {
  it("copies every profile's category once (paging), then skips", async () => {
    const r = harnessResolvers(h);
    for (const [appDid, name] of [[APP, "a"], [APP_2, "b"], [APP_3, "c"]]) await r.upsert({ appDid, name });
    // Rows from before the column: no category recorded yet.
    const docs = Object.fromEntries(
      await Promise.all(
        [[APP, "Games"], [APP_2, null], [APP_3, "Tools"]].map(async ([appDid, category]) => {
          const entry = (await r.index.appProfile(appDid!))!;
          return [entry.documentId, profileDoc(appDid!, category)] as const;
        }),
      ),
    );
    const reactor = reactorWith(docs);

    const result = await backfillAppCategories({ index: r.index, reactorClient: reactor.client, now, logger: quiet, pageSize: 2 });
    expect(result).toEqual({ status: "done", documents: 3, failed: 0 });
    expect(await categories()).toEqual(
      [
        { app_did: APP, category: "Games" },
        { app_did: APP_2, category: null },
        { app_did: APP_3, category: "Tools" },
      ].sort((a, b) => (a.app_did < b.app_did ? -1 : 1)),
    );
    expect(await r.index.jobDone(CATEGORY_BACKFILL_JOB)).toBe(true);

    reactor.get.mockClear();
    expect(await backfillAppCategories({ index: r.index, reactorClient: reactor.client, now, logger: quiet })).toEqual({
      status: "skipped",
      documents: 0,
      failed: 0,
    });
    expect(reactor.get).not.toHaveBeenCalled();
  });

  it("leaves the job open when a document cannot be read, and finishes on the next run", async () => {
    const r = harnessResolvers(h);
    await r.upsert({ appDid: APP, name: "a" });
    await r.upsert({ appDid: APP_2, name: "b" });
    const one = (await r.index.appProfile(APP))!.documentId;
    const two = (await r.index.appProfile(APP_2))!.documentId;
    const warn = vi.fn();

    const partial = reactorWith({ [one]: profileDoc(APP, "Games") });
    const first = await backfillAppCategories({
      index: r.index,
      reactorClient: partial.client,
      now,
      logger: { info: vi.fn(), warn },
    });
    expect(first).toEqual({ status: "incomplete", documents: 1, failed: 1 });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(two));
    expect(await r.index.jobDone(CATEGORY_BACKFILL_JOB)).toBe(false);

    const full = reactorWith({ [one]: profileDoc(APP, "Games"), [two]: profileDoc(APP_2, "Tools") });
    const second = await backfillAppCategories({ index: r.index, reactorClient: full.client, now, logger: quiet });
    expect(second).toEqual({ status: "done", documents: 2, failed: 0 });
    expect(await r.index.appProfileCategories()).toEqual([
      { category: "Games", count: 1 },
      { category: "Tools", count: 1 },
    ]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run subgraphs/renown-stats/tests/category-index.test.ts`
Expected: FAIL — `Failed to load url ../core/category-backfill.js` (module does not exist).

- [ ] **Step 3: Create the backfill** — `subgraphs/renown-stats/core/category-backfill.ts`:

```ts
import type { IReactorClient } from "@powerhousedao/reactor";
import type { RenownAppProfileDocument } from "../../../document-models/renown-app-profile/index.js";
import type { AppProfileCursor, StatsIndex } from "../store/types.js";

/** The job name in renown_stats_jobs; bump the suffix to run a new backfill. */
export const CATEGORY_BACKFILL_JOB = "app-profile-category-backfill-v1";

export interface CategoryBackfillResult {
  status: "done" | "skipped" | "incomplete";
  documents: number;
  failed: number;
}

export interface CategoryBackfillDeps {
  index: StatsIndex;
  reactorClient: Pick<IReactorClient, "get">;
  now: () => Date;
  logger?: Pick<Console, "info" | "warn">;
  /** Profiles read per page (default 200). */
  pageSize?: number;
}

/**
 * Copies the category of every existing app-profile document into
 * app_profile_documents.category, once. Idempotent: it writes what the
 * document holds, as every later save does. A document that cannot be read is
 * logged and leaves the job open, so the next start retries the whole pass.
 */
export async function backfillAppCategories(deps: CategoryBackfillDeps): Promise<CategoryBackfillResult> {
  const { index } = deps;
  const logger = deps.logger ?? console;
  const pageSize = deps.pageSize ?? 200;
  if (await index.jobDone(CATEGORY_BACKFILL_JOB)) {
    return { status: "skipped", documents: 0, failed: 0 };
  }
  let documents = 0;
  let failed = 0;
  let after: AppProfileCursor | undefined;
  for (;;) {
    const page = await index.appProfilesPage(pageSize, after);
    for (const entry of page) {
      try {
        const doc = await deps.reactorClient.get<RenownAppProfileDocument>(entry.documentId);
        // Profiles from before the rich fields have no category key at all.
        const state = doc.state.global as Partial<RenownAppProfileDocument["state"]["global"]>;
        await index.setAppCategory(entry.appDid, state.category ?? null);
        documents++;
      } catch (error) {
        failed++;
        const reason = error instanceof Error ? error.message : String(error);
        logger.warn(
          `[renown-stats] category backfill of ${entry.documentId} failed (${reason}); retried on the next start`,
        );
      }
    }
    const last = page.at(-1);
    if (page.length < pageSize || !last) break;
    after = { createdAt: last.createdAt, appDid: last.appDid };
  }
  if (failed > 0) return { status: "incomplete", documents, failed };
  await index.markJobDone(CATEGORY_BACKFILL_JOB, deps.now());
  if (documents > 0) logger.info(`[renown-stats] backfilled the category of ${documents} app profiles`);
  return { status: "done", documents, failed };
}
```

- [ ] **Step 4: Heal the category on every save** — in `subgraphs/renown-stats/resolvers.ts`, inside `upsertAppProfile`, replace the comment

```ts
          // Every save heals the image index from the resulting document, so a
          // failed write on an earlier save is repaired by the next one.
```

with

```ts
          // Every save heals the image and category index from the resulting
          // document, so a failed write on an earlier save is repaired by the next one.
```

and, in the same `try` block, directly after the `await index.setAppImages(…, now());` statement, add:

```ts
            await index.setAppCategory(appDid, state.category ?? null);
```

(A failure there is already mapped to `SERVICE_UNAVAILABLE` "Image index is temporarily unavailable" by the surrounding `catch`; a retried save repairs it.)

- [ ] **Step 5: Run the backfill at setup** — in `subgraphs/renown-stats/index.ts` add the import after the `backfillAppMetricValues` import:

```ts
import { backfillAppCategories } from "./core/category-backfill.js";
```

and replace the block

```ts
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

with

```ts
      // One-time and idempotent: app_metric_values from the user-stats
      // documents written before Phase 3, then each profile's category. In
      // the background, so the host's startup never waits for them; one
      // failing never stops the other.
      const deps = { index, reactorClient: this.reactorClient, now: () => new Date() };
      const settle = (what: string) => (error: unknown) => {
        const reason = error instanceof Error ? error.message : "unknown error";
        console.warn(`[renown-stats] ${what} backfill failed (${reason}); retried on the next start`);
      };
      this.#backfill = backfillAppMetricValues(deps)
        .then(() => undefined, settle("metric"))
        .then(() => backfillAppCategories(deps))
        .then(() => undefined, settle("category"));
```

- [ ] **Step 6: Update the setup test** — in `subgraphs/renown-stats/tests/subgraph.test.ts` ("runs the one-time backfill at setup and records it") replace

```ts
    const jobs = await namespace!.selectFrom("renown_stats_jobs").select("name").execute();
    expect(jobs.map((job) => job.name)).toEqual(["app-metric-values-backfill-v1"]);
```

with

```ts
    const jobs = await namespace!.selectFrom("renown_stats_jobs").select("name").orderBy("name").execute();
    expect(jobs.map((job) => job.name)).toEqual(["app-metric-values-backfill-v1", "app-profile-category-backfill-v1"]);
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run subgraphs/renown-stats`
Expected: PASS (category-index 3/3, subgraph suite green).
Run: `npm run tsc && npm run lint 2>&1 | grep -E " error |renown-stats"` — expected: no output.

- [ ] **Step 8: Commit**

```bash
git add subgraphs/renown-stats/core/category-backfill.ts subgraphs/renown-stats/resolvers.ts subgraphs/renown-stats/index.ts subgraphs/renown-stats/tests/category-index.test.ts subgraphs/renown-stats/tests/subgraph.test.ts
git commit -m "feat(stats): keep app-profile categories indexed (save heal + backfill)"
```

---

### Task 3: GraphQL — `appProfiles(category)` and `appProfileCategories`

**Files:**
- Modify: `subgraphs/renown-stats/schema.ts`
- Modify: `subgraphs/renown-stats/resolvers.ts` (store-type import, `appProfiles`, new `appProfileCategories`)
- Modify: `subgraphs/renown-stats/tests/harness.ts` (`harnessResolvers` return value)
- Test: `subgraphs/renown-stats/tests/app-catalog.test.ts` (create)

**Interfaces:**
- Consumes: `StatsIndex.appProfilesPage(limit, after, category)`, `StatsIndex.appProfileCategories()`, `AppCategoryCount` (Task 1); category heal (Task 2).
- Produces: the `appProfiles(…, category: String)` and `appProfileCategories: [AppProfileCategory!]!` SDL from "Interfaces produced"; harness helpers `appProfiles(args)` and `appProfileCategories()`.

- [ ] **Step 1: Add harness helpers** — in `subgraphs/renown-stats/tests/harness.ts`, in the object returned by `harnessResolvers`, after the `userStats: …` line add:

```ts
    appProfiles: (args: { limit?: number | null; after?: string | null; category?: string | null }) =>
      resolvers.Query.appProfiles(null, args, {}) as Promise<{ items: { appDid: string; category: string | null }[]; next: string | null }>,
    appProfileCategories: () =>
      resolvers.Query.appProfileCategories(null, {}, {}) as Promise<{ category: string; count: number }[]>,
```

- [ ] **Step 2: Write the failing test** — create `subgraphs/renown-stats/tests/app-catalog.test.ts`:

```ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { failure, harnessResolvers, openHarness, registerApp, resetHarness, type Harness } from "./harness.js";

const APP = "did:key:zDnaerDaTF5BXEavCrfRZEk316dpbLsfPDZ3WJ5hRTPFU2169";
const APP_2 = "did:key:z6MkjchhfUsD6mmvni8mCdXHw216Xrm9bQe2mBH1P5RDjVJG";
const APP_3 = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";
const APP_4 = "did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH";

let h: Harness;
beforeAll(async () => {
  h = await openHarness();
});
afterAll(async () => {
  await h.root.destroy();
});
beforeEach(async () => {
  await resetHarness(h);
  for (const appDid of [APP, APP_2, APP_3, APP_4]) await registerApp(h, appDid);
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** APP "DeFi", APP_2 "Games", APP_3 "defi", APP_4 none — created in that order. */
async function catalog() {
  const r = harnessResolvers(h);
  await r.upsert({ appDid: APP, name: "One", category: "DeFi" });
  await r.upsert({ appDid: APP_2, name: "Two", category: "Games" });
  await r.upsert({ appDid: APP_3, name: "Three", category: "defi" });
  await r.upsert({ appDid: APP_4, name: "Four" });
  return r;
}

describe("appProfiles(category)", () => {
  it("returns only profiles of that category, case-insensitively, newest first", async () => {
    const r = await catalog();
    const page = await r.appProfiles({ category: "DEFI" });
    expect(page.items.map((p) => [p.appDid, p.category])).toEqual([
      [APP_3, "defi"],
      [APP, "DeFi"],
    ]);
    expect(page.next).toBeNull();
    expect((await r.appProfiles({ category: "  games " })).items.map((p) => p.appDid)).toEqual([APP_2]);
  });

  it("pages within the category with the same cursor rules", async () => {
    const r = await catalog();
    const first = await r.appProfiles({ category: "defi", limit: 1 });
    expect(first.items.map((p) => p.appDid)).toEqual([APP_3]);
    expect(first.next).toEqual(expect.any(String));
    const second = await r.appProfiles({ category: "defi", limit: 1, after: first.next });
    expect(second.items.map((p) => p.appDid)).toEqual([APP]);
    expect(second.next).toBeNull();
  });

  it.each([[undefined], [null], [""], ["   "]])("treats category %j as no filter", async (category) => {
    const r = await catalog();
    expect((await r.appProfiles({ category })).items.map((p) => p.appDid)).toEqual([APP_4, APP_3, APP_2, APP]);
  });

  it("answers an empty page for a category nobody uses", async () => {
    const r = await catalog();
    expect(await r.appProfiles({ category: "Unknown" })).toEqual({ items: [], next: null });
  });

  it("follows a profile whose category changes", async () => {
    const r = await catalog();
    await r.upsert({ appDid: APP_2, category: "DeFi" });
    expect((await r.appProfiles({ category: "games" })).items).toEqual([]);
    expect((await r.appProfiles({ category: "defi" })).items.map((p) => p.appDid)).toEqual([APP_3, APP_2, APP]);
  });

  it("keeps the limit rules with a category", async () => {
    const r = await catalog();
    expect((await failure(r.appProfiles({ category: "defi", limit: 0 }))).code).toBe("BAD_USER_INPUT");
    expect((await failure(r.appProfiles({ category: "defi", limit: 51 }))).code).toBe("BAD_USER_INPUT");
  });
});

describe("appProfileCategories", () => {
  it("lists non-empty categories with their counts, by count desc then name", async () => {
    const r = await catalog();
    expect(await r.appProfileCategories()).toEqual([
      { category: "DeFi", count: 2 },
      { category: "Games", count: 1 },
    ]);
  });

  it("is empty without profiles", async () => {
    expect(await harnessResolvers(h).appProfileCategories()).toEqual([]);
  });

  it("answers SERVICE_UNAVAILABLE when the index cannot be read", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const r = harnessResolvers(h);
    vi.spyOn(r.index, "appProfileCategories").mockRejectedValue(new Error("db down"));
    expect(await failure(r.appProfileCategories())).toEqual({
      code: "SERVICE_UNAVAILABLE",
      field: undefined,
      message: "Stats are temporarily unavailable",
    });
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run subgraphs/renown-stats/tests/app-catalog.test.ts`
Expected: FAIL — category filters return every profile, and `resolvers.Query.appProfileCategories is not a function`.

- [ ] **Step 4: Schema** — in `subgraphs/renown-stats/schema.ts` insert directly above `input AppProfileLinkInput {`:

```graphql
  "A category used by app profiles, and how many carry it (case-insensitively)."
  type AppProfileCategory {
    "The smallest spelling (byte order) among the profiles that carry it."
    category: String!
    count: Int!
  }

```

and in `type Query` replace

```graphql
    "Every app profile, newest first. limit 1-50 (default 20)."
    appProfiles(limit: Int, after: String): AppProfilePage!
```

with

```graphql
    """
    Every app profile, newest first. limit 1-50 (default 20). category: only
    profiles whose category equals it case-insensitively (trimmed); blank or
    absent = all. Pass the same category with after.
    """
    appProfiles(limit: Int, after: String, category: String): AppProfilePage!
    "Non-empty categories of app profiles: count desc, then name."
    appProfileCategories: [AppProfileCategory!]!
```

- [ ] **Step 5: Resolvers** — in `subgraphs/renown-stats/resolvers.ts`:

Add `AppCategoryCount,` as the first name in `import type { … } from "./store/types.js";`.

In `appProfiles`, replace the args type and the index call:

```ts
        args: {
          limit?: number | null;
          after?: string | null;
          category?: string | null;
        },
```

and

```ts
        const after = args.after ? decodeCursor(args.after) : undefined;
        // Stored categories are trimmed; blank means no filter.
        const category = args.category?.trim() || undefined;
        const entries = await requireIndex().appProfilesPage(
          limit + 1,
          after,
          category,
        );
```

(the rest of `appProfiles` — slicing, `next` cursor — is unchanged; the cursor is valid within the same filter.)

Add a new resolver directly after `appProfiles` (before `appStats`):

```ts
      appProfileCategories: async (): Promise<AppCategoryCount[]> => {
        const index = requireIndex();
        try {
          return await index.appProfileCategories();
        } catch (error) {
          throw unavailable(error);
        }
      },

```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run subgraphs/renown-stats`
Expected: PASS (app-catalog 12/12).
Run: `npm run tsc && npm run lint 2>&1 | grep -E " error |renown-stats"` — expected: no output.

- [ ] **Step 7: Commit**

```bash
git add subgraphs/renown-stats/schema.ts subgraphs/renown-stats/resolvers.ts subgraphs/renown-stats/tests/harness.ts subgraphs/renown-stats/tests/app-catalog.test.ts
git commit -m "feat(stats): filter app profiles by category and list categories"
```

---

### Task 4: GraphQL — `renownNetworkStats` (read-model counts, 300 s cache)

**Files:**
- Modify: `subgraphs/renown-stats/lookups.ts` (import `sql`; two new exports at the end)
- Modify: `subgraphs/renown-stats/schema.ts`
- Modify: `subgraphs/renown-stats/resolvers.ts` (imports, TTL constant, output type, cache state, `computeNetworkStats`, resolver)
- Modify: `subgraphs/renown-stats/tests/harness.ts` (`NetworkStatsOut`, `networkStats()` helper)
- Modify: `subgraphs/renown-stats/tests/subgraph.test.ts` ("never fails the host when its namespace is unavailable")
- Test: `subgraphs/renown-stats/tests/network-stats.test.ts` (create)

**Interfaces:**
- Consumes: `StatsIndex.networkActivity(since)` (Task 1); `ACTIVE_WINDOW_MS` from `core/app-stats.ts` (30 days); `unavailable()`, `requireIndex()`, `now()` inside `createResolvers`.
- Produces:
  - `lookups.ts`: `identityCount(db: ReadModelDb): Promise<number>`, `activeCredentialCount(db: ReadModelDb, now: Date): Promise<number>`
  - `resolvers.ts`: `export const NETWORK_STATS_TTL_MS = 300_000`; `Query.renownNetworkStats` per the SDL.

- [ ] **Step 1: Harness** — in `subgraphs/renown-stats/tests/harness.ts`, directly above the `/** Resolvers over the harness. …` comment add:

```ts
/** What renownNetworkStats answers. */
export interface NetworkStatsOut {
  identities: number;
  apps: number;
  activeCredentials: number;
  activeUsers30d: number;
  updatedAt: string;
}

```

and in the object returned by `harnessResolvers`, after `appProfileCategories: …`, add:

```ts
    networkStats: () => resolvers.Query.renownNetworkStats(null, {}, {}) as Promise<NetworkStatsOut>,
```

- [ ] **Step 2: Write the failing tests** — create `subgraphs/renown-stats/tests/network-stats.test.ts`:

```ts
import type { IRelationalDb } from "@powerhousedao/reactor-browser";
import { generateId } from "document-model";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pkhDidFor } from "../core/dids.js";
import {
  CRED_NS,
  failure,
  harnessResolvers,
  insertProfile,
  openHarness,
  registerApp,
  resetHarness,
  type Harness,
} from "./harness.js";

const APP = "did:key:zDnaerDaTF5BXEavCrfRZEk316dpbLsfPDZ3WJ5hRTPFU2169";
const APP_2 = "did:key:z6MkjchhfUsD6mmvni8mCdXHw216Xrm9bQe2mBH1P5RDjVJG";
const NOW = new Date("2026-10-09T12:00:00Z");
const DAY = 86_400_000;
const addr = (n: number) => `0x${"0".repeat(38)}b${n}`;

let h: Harness;
beforeAll(async () => {
  h = await openHarness();
});
afterAll(async () => {
  await h.root.destroy();
});
beforeEach(async () => {
  await resetHarness(h);
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** A credential row as the renown-credential processor writes it. */
async function credential(row: { expiration: Date | null; revoked?: boolean; credentialId?: string }): Promise<void> {
  const T0 = new Date("2026-01-01T00:00:00Z");
  const owner = addr(9);
  await h.root
    .withSchema(CRED_NS)
    .insertInto("renown_credential")
    .values({
      document_id: generateId(),
      context: "[]",
      credential_id: row.credentialId ?? generateId(),
      type: "[]",
      issuer_id: pkhDidFor(owner),
      issuer_ethereum_address: owner,
      issuance_date: T0,
      expiration_date: row.expiration,
      credential_subject_id: APP,
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
      revoked: row.revoked ?? false,
      revoked_at: row.revoked ? T0 : null,
      revocation_reason: null,
    })
    .execute();
}

/** A clock the test moves by hand. */
function clock(start = NOW) {
  let t = start.getTime();
  return { now: () => new Date(t), advance: (ms: number) => (t += ms) };
}

describe("renownNetworkStats", () => {
  it("counts identities, apps, live credentials and users active in the last 30 days", async () => {
    const c = clock();
    const r = harnessResolvers(h, { now: c.now });
    // Identities: distinct lower-cased addresses; two profile documents of one wallet count once.
    await insertProfile(h, { address: addr(1), documentId: "doc-1" });
    await insertProfile(h, { address: addr(1).toUpperCase().replace("0X", "0x"), documentId: "doc-1b" });
    await insertProfile(h, { address: addr(2), documentId: "doc-2" });
    // Apps: profiles. registerApp also writes one live delegation credential each.
    await registerApp(h, APP);
    await registerApp(h, APP_2);
    await r.upsert({ appDid: APP, name: "One" });
    await r.upsert({ appDid: APP_2, name: "Two" });
    // Credentials: live = unrevoked and (no expiry or expiry after now); copies of one VC count once.
    await credential({ expiration: null });
    await credential({ expiration: new Date(NOW.getTime() + 1000), credentialId: "vc-dup" });
    await credential({ expiration: new Date(NOW.getTime() + 1000), credentialId: "vc-dup" });
    await credential({ expiration: new Date(NOW.getTime() - 1000) });
    await credential({ expiration: NOW });
    await credential({ expiration: null, revoked: true });
    // Active users: any report to any app in the last 30 days, each user once.
    const record = (userDid: string, appDid: string, at: Date) =>
      r.index.recordMetricValues([{ appDid, metric: "m", userDid, value: 1, updatedAt: at }]);
    await record("u1", APP, new Date(NOW.getTime() - DAY));
    await record("u1", APP_2, new Date(NOW.getTime() - 2 * DAY));
    await record("u2", "did:key:zNoProfile", new Date(NOW.getTime() - 30 * DAY));
    await record("u3", APP, new Date(NOW.getTime() - 31 * DAY));

    expect(await r.networkStats()).toEqual({
      identities: 2,
      apps: 2,
      activeCredentials: 4, // registerApp x2, no-expiry, vc-dup
      activeUsers30d: 2,
      updatedAt: NOW.toISOString(),
    });
  });

  it("answers zeros on an empty network", async () => {
    const r = harnessResolvers(h, { now: clock().now });
    expect(await r.networkStats()).toEqual({
      identities: 0,
      apps: 0,
      activeCredentials: 0,
      activeUsers30d: 0,
      updatedAt: NOW.toISOString(),
    });
  });

  it("serves the cached answer for 300 s, then recomputes", async () => {
    const c = clock();
    const r = harnessResolvers(h, { now: c.now });
    await insertProfile(h, { address: addr(1), documentId: "doc-1" });
    expect((await r.networkStats()).identities).toBe(1);

    await insertProfile(h, { address: addr(2), documentId: "doc-2" });
    c.advance(299_999);
    expect(await r.networkStats()).toMatchObject({ identities: 1, updatedAt: NOW.toISOString() });

    c.advance(1);
    expect(await r.networkStats()).toMatchObject({
      identities: 2,
      updatedAt: new Date(NOW.getTime() + 300_000).toISOString(),
    });
  });

  it("shares one computation between concurrent requests", async () => {
    const r = harnessResolvers(h, { now: clock().now });
    const activity = vi.spyOn(r.index, "networkActivity");
    const [a, b] = await Promise.all([r.networkStats(), r.networkStats()]);
    expect(a).toEqual(b);
    expect(activity).toHaveBeenCalledTimes(1);
  });

  it("answers SERVICE_UNAVAILABLE when a read model fails, and does not cache the failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let down = true;
    const relationalDb = {
      queryNamespace: (namespace: string) => {
        if (down) throw new Error("relation does not exist");
        return h.root.withSchema(namespace);
      },
    } as unknown as IRelationalDb<unknown>;
    const r = harnessResolvers(h, { now: clock().now, relationalDb });
    expect(await failure(r.networkStats())).toEqual({
      code: "SERVICE_UNAVAILABLE",
      field: undefined,
      message: "Stats are temporarily unavailable",
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("relation does not exist"));
    down = false;
    expect((await r.networkStats()).identities).toBe(0);
  });

  it("answers SERVICE_UNAVAILABLE when the stats index fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const r = harnessResolvers(h, { now: clock().now });
    vi.spyOn(r.index, "networkActivity").mockRejectedValue(new Error("db down"));
    expect((await failure(r.networkStats())).code).toBe("SERVICE_UNAVAILABLE");
  });
});
```

and in `subgraphs/renown-stats/tests/subgraph.test.ts`, test "never fails the host when its namespace is unavailable", directly after `expect((result as GraphQLError).extensions.code).toBe("SERVICE_NOT_CONFIGURED");` add:

```ts
    for (const field of ["appProfileCategories", "renownNetworkStats"]) {
      const refused = await resolver("Query", field)(null, {}, {}).catch((e: unknown) => e);
      expect((refused as GraphQLError).extensions.code).toBe("SERVICE_NOT_CONFIGURED");
    }
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run subgraphs/renown-stats/tests/network-stats.test.ts subgraphs/renown-stats/tests/subgraph.test.ts`
Expected: FAIL — 7 failed, `TypeError: resolvers.Query.renownNetworkStats is not a function`.

- [ ] **Step 4: Read-model counts** — in `subgraphs/renown-stats/lookups.ts` add as the first import:

```ts
import { sql } from "kysely";
```

and append at the end of the file:

```ts
/**
 * Distinct wallets (lower-cased `eth_address`) with a Renown profile in the
 * renown-user read model. Throws when the read model is unavailable.
 */
export async function identityCount(db: ReadModelDb): Promise<number> {
  const row = await RenownUserProcessor.query<RenownUserDB>("renown-user", db)
    .selectFrom("renown_user")
    .select(sql<number>`count(distinct lower(eth_address))::int`.as("identities"))
    .where("eth_address", "is not", null)
    .where("eth_address", "<>", "")
    .executeTakeFirstOrThrow();
  return Number(row.identities);
}

/**
 * Live credentials: unrevoked, and unexpired at `now` (no expiry counts as
 * live). Counted by VC id, since copies of one credential can exist as
 * several documents. Throws when the read model is unavailable.
 */
export async function activeCredentialCount(db: ReadModelDb, now: Date): Promise<number> {
  const row = await RenownCredentialProcessor.query<RenownCredentialDB>("renown-credential", db)
    .selectFrom("renown_credential")
    .select(sql<number>`count(distinct credential_id)::int`.as("credentials"))
    .where("revoked", "=", false)
    .where((eb) => eb.or([eb("expiration_date", "is", null), eb("expiration_date", ">", now)]))
    .executeTakeFirstOrThrow();
  return Number(row.credentials);
}
```

- [ ] **Step 5: Schema** — in `subgraphs/renown-stats/schema.ts` insert directly above `input AppProfileLinkInput {`:

```graphql
  "Network-wide counts, recomputed at most every 300 s."
  type RenownNetworkStats {
    "Distinct wallets (lower-cased) with a Renown profile."
    identities: Int!
    "App profiles."
    apps: Int!
    "Unrevoked credentials with no expiry or an expiry in the future (by credential id)."
    activeCredentials: Int!
    "Distinct users any app reported a stat for in the last 30 days."
    activeUsers30d: Int!
    "ISO time the counts were computed."
    updatedAt: String!
  }

```

and in `type Query`, directly above the `"Public stats of an app; …"` description of `appStats`, add:

```graphql
    "Network-wide counts; SERVICE_UNAVAILABLE when a read model cannot be read."
    renownNetworkStats: RenownNetworkStats!
```

- [ ] **Step 6: Resolver** — in `subgraphs/renown-stats/resolvers.ts`:

Extend the `./lookups.js` import to

```ts
import {
  activeCredentialCount,
  contributorProfiles,
  hasDelegation,
  identityCount,
  workloadOwner,
  type ContributorProfile,
} from "./lookups.js";
```

After `const MAX_PAGE = 50;` add:

```ts
/** How long renownNetworkStats serves one computation. */
export const NETWORK_STATS_TTL_MS = 300_000;
```

Directly above `/** What stats readers need of an app's profile. */` (the `AppCard` interface) add:

```ts
interface NetworkStatsOutput {
  identities: number;
  apps: number;
  activeCredentials: number;
  activeUsers30d: number;
  updatedAt: string;
}

```

Inside `createResolvers`, after `const lock = createKeyedLock();` add:

```ts
  /** The last renownNetworkStats answer, until expiresAt (ms); failures are never cached. */
  let networkStats: { value: NetworkStatsOutput; expiresAt: number } | undefined;
  let networkStatsLoad: Promise<NetworkStatsOutput> | undefined;
```

Directly above `function contributorOutput(` (i.e. after the `unavailable` helper) add:

```ts
  /** Fresh network-wide counts, read from three namespaces in parallel. */
  async function computeNetworkStats(
    index: StatsIndex,
  ): Promise<NetworkStatsOutput> {
    const at = now();
    const since = new Date(at.getTime() - ACTIVE_WINDOW_MS);
    try {
      const [activity, identities, activeCredentials] = await Promise.all([
        index.networkActivity(since),
        identityCount(relationalDb),
        activeCredentialCount(relationalDb, at),
      ]);
      return {
        identities,
        apps: activity.apps,
        activeCredentials,
        activeUsers30d: activity.activeUsers,
        updatedAt: at.toISOString(),
      };
    } catch (error) {
      throw unavailable(error);
    }
  }

```

In `Query`, directly after the `appProfileCategories` resolver (before `appStats`) add:

```ts
      renownNetworkStats: async (): Promise<NetworkStatsOutput> => {
        const index = requireIndex();
        if (networkStats && now().getTime() < networkStats.expiresAt) {
          return networkStats.value;
        }
        // Concurrent requests share one computation.
        networkStatsLoad ??= computeNetworkStats(index)
          .then((value) => {
            networkStats = {
              value,
              expiresAt: new Date(value.updatedAt).getTime() + NETWORK_STATS_TTL_MS,
            };
            return value;
          })
          .finally(() => {
            networkStatsLoad = undefined;
          });
        return networkStatsLoad;
      },

```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run subgraphs/renown-stats`
Expected: PASS — 165 tests in 13 files (138 before this plan + 6 + 3 + 12 + 6).
Run: `npm run tsc && npm run lint 2>&1 | grep -E " error |renown-stats"` — expected: no output.

- [ ] **Step 8: Commit**

```bash
git add subgraphs/renown-stats/lookups.ts subgraphs/renown-stats/schema.ts subgraphs/renown-stats/resolvers.ts subgraphs/renown-stats/tests/harness.ts subgraphs/renown-stats/tests/network-stats.test.ts subgraphs/renown-stats/tests/subgraph.test.ts
git commit -m "feat(stats): renownNetworkStats with a 300 s in-process cache"
```

---

### Task 5: Rollout smoke script and docs

**Files:**
- Create: `scripts/smoke/network-stats.ts`
- Modify: `scripts/smoke/README.md` (new section at the end)
- Modify: `subgraphs/renown-stats/README.md` ("Reads are public" paragraph; new section at the end)

**Interfaces:**
- Consumes: the SDL from Tasks 3–4 over `POST <switchboard>/graphql` (supergraph), anonymous.
- Produces: `node scripts/smoke/network-stats.ts [--switchboard <url>]` — exit 0 and a final `[smoke] OK` line, or exit 1 with `[smoke] FAILED: <reason>`. Default switchboard: `https://switchboard.renown-staging.vetra.io`.

- [ ] **Step 1: Create the script** — `scripts/smoke/network-stats.ts` (Node 24 strips the types; no TS-only syntax such as enums or parameter properties):

```ts
/**
 * Read-only smoke test of the renown.id site-polish reads on a switchboard:
 *
 *   node scripts/smoke/network-stats.ts [--switchboard <url>]
 *
 * It checks, with anonymous GraphQL requests only:
 *   1. renownNetworkStats answers non-negative integers and an ISO updatedAt,
 *      and a second request within 300 s answers the same updatedAt (cache);
 *   2. appProfileCategories is ordered count desc, then name, with non-empty
 *      names and positive counts;
 *   3. appProfiles(category) for the first category (in a different case)
 *      returns only profiles of that category, pages to the end, and never
 *      more than its count; a blank category returns the unfiltered page.
 *
 * Writes nothing, so it needs no --allow-prod. Exits 1 on any failure.
 */

const STAGING_SWITCHBOARD = "https://switchboard.renown-staging.vetra.io";

class SmokeFailure extends Error {}

interface Args {
  switchboard: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { switchboard: STAGING_SWITCHBOARD };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--switchboard") {
      const v = argv[++i];
      if (!v) throw new SmokeFailure("--switchboard needs a URL");
      args.switchboard = v;
    } else if (arg === "--help" || arg === "-h") {
      console.log("usage: network-stats.ts [--switchboard <url>]");
      process.exit(0);
    } else throw new SmokeFailure(`unknown argument: ${arg}`);
  }
  args.switchboard = args.switchboard.replace(/\/+$/, "").replace(/\/graphql$/, "");
  return args;
}

function step(label: string, detail = ""): void {
  console.log(`[smoke] ${label}${detail ? ` ${detail}` : ""}`);
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new SmokeFailure(message);
}

function clip(text: string): string {
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

interface GraphqlResult<T> {
  data?: T;
  errors?: { message: string; extensions?: { code?: string } }[];
}

async function query<T>(switchboard: string, document: string, variables: unknown = {}): Promise<T> {
  const res = await fetch(`${switchboard}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: document, variables }),
  });
  const text = await res.text();
  let result: GraphqlResult<T>;
  try {
    result = JSON.parse(text) as GraphqlResult<T>;
  } catch {
    throw new SmokeFailure(`GraphQL HTTP ${res.status}: ${clip(text)}`);
  }
  if (result.errors?.length || !result.data) {
    throw new SmokeFailure(`GraphQL HTTP ${res.status}: ${clip(JSON.stringify(result.errors ?? result))}`);
  }
  return result.data;
}

interface NetworkStats {
  identities: number;
  apps: number;
  activeCredentials: number;
  activeUsers30d: number;
  updatedAt: string;
}

interface Category {
  category: string;
  count: number;
}

interface Page {
  items: { appDid: string; category: string | null }[];
  next: string | null;
}

const NETWORK_STATS = `query { renownNetworkStats { identities apps activeCredentials activeUsers30d updatedAt } }`;
const CATEGORIES = `query { appProfileCategories { category count } }`;
const PROFILES = `query Profiles($limit: Int, $after: String, $category: String) {
  appProfiles(limit: $limit, after: $after, category: $category) { items { appDid category } next }
}`;

async function checkNetworkStats(switchboard: string): Promise<void> {
  const first = (await query<{ renownNetworkStats: NetworkStats }>(switchboard, NETWORK_STATS)).renownNetworkStats;
  for (const key of ["identities", "apps", "activeCredentials", "activeUsers30d"] as const) {
    check(Number.isInteger(first[key]) && first[key] >= 0, `renownNetworkStats.${key} is ${first[key]}`);
  }
  check(!Number.isNaN(Date.parse(first.updatedAt)), `renownNetworkStats.updatedAt is ${first.updatedAt}`);
  step(
    "renownNetworkStats",
    `identities=${first.identities} apps=${first.apps} activeCredentials=${first.activeCredentials} activeUsers30d=${first.activeUsers30d} updatedAt=${first.updatedAt}`,
  );
  const second = (await query<{ renownNetworkStats: NetworkStats }>(switchboard, NETWORK_STATS)).renownNetworkStats;
  // Several replicas each keep their own cache; only a same-replica answer must match.
  if (second.updatedAt === first.updatedAt) step("renownNetworkStats cached", "same updatedAt on the second request");
  else step("renownNetworkStats second request", `updatedAt=${second.updatedAt} (another replica or the 300 s window ended)`);
}

async function checkCategories(switchboard: string): Promise<Category[]> {
  const categories = (await query<{ appProfileCategories: Category[] }>(switchboard, CATEGORIES)).appProfileCategories;
  categories.forEach((c, i) => {
    check(c.category.trim() !== "", `appProfileCategories[${i}] has an empty name`);
    check(Number.isInteger(c.count) && c.count > 0, `appProfileCategories[${i}].count is ${c.count}`);
    if (i > 0) {
      const prev = categories[i - 1];
      check(
        prev.count > c.count || (prev.count === c.count && prev.category.toLowerCase() <= c.category.toLowerCase()),
        `appProfileCategories is not ordered at ${i}: ${JSON.stringify(prev)} before ${JSON.stringify(c)}`,
      );
    }
  });
  step("appProfileCategories", categories.map((c) => `${c.category}=${c.count}`).join(", ") || "(none)");
  return categories;
}

async function checkCategoryFilter(switchboard: string, categories: Category[]): Promise<void> {
  const all = (await query<{ appProfiles: Page }>(switchboard, PROFILES, { limit: 50 })).appProfiles;
  const blank = (await query<{ appProfiles: Page }>(switchboard, PROFILES, { limit: 50, category: "  " })).appProfiles;
  check(
    JSON.stringify(blank.items.map((p) => p.appDid)) === JSON.stringify(all.items.map((p) => p.appDid)),
    "appProfiles with a blank category differs from the unfiltered list",
  );
  step("appProfiles blank category", `= unfiltered (${all.items.length} on the first page)`);

  if (categories.length === 0) {
    step("appProfiles(category)", "skipped: no categories yet");
    return;
  }
  const target = categories[0];
  // Swapped case: the filter must be case-insensitive.
  const asked = target.category === target.category.toUpperCase() ? target.category.toLowerCase() : target.category.toUpperCase();
  const seen: string[] = [];
  let after: string | null = null;
  for (let pages = 0; pages < 100; pages++) {
    const page: Page = (await query<{ appProfiles: Page }>(switchboard, PROFILES, { limit: 2, after, category: asked }))
      .appProfiles;
    for (const item of page.items) {
      check(
        item.category?.toLowerCase() === target.category.toLowerCase(),
        `appProfiles(category: ${asked}) returned ${item.appDid} with category ${item.category}`,
      );
      check(!seen.includes(item.appDid), `appProfiles(category: ${asked}) repeated ${item.appDid}`);
      seen.push(item.appDid);
    }
    after = page.next;
    if (after === null) break;
  }
  check(after === null, `appProfiles(category: ${asked}) did not end within 100 pages`);
  check(seen.length >= 1 && seen.length <= target.count, `appProfiles(category: ${asked}) listed ${seen.length}, count is ${target.count}`);
  step("appProfiles(category)", `${asked}: ${seen.length} of ${target.count} (unreadable profiles are skipped)`);
}

async function main(): Promise<void> {
  const { switchboard } = parseArgs(process.argv.slice(2));
  step("switchboard", switchboard);
  await checkNetworkStats(switchboard);
  const categories = await checkCategories(switchboard);
  await checkCategoryFilter(switchboard, categories);
  step("OK");
}

main().catch((error: unknown) => {
  console.error(`[smoke] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
```

- [ ] **Step 2: Verify it against a fake switchboard** (the real ones do not serve the fields until rollout). Save outside the repo as `$TMP/fake-switchboard.mjs`:

```js
import http from "node:http";
const apps = [["did:key:z1", "DeFi"], ["did:key:z2", "Games"], ["did:key:z3", "defi"], ["did:key:z4", null], ["did:key:z5", "DEFI"]];
const stats = { identities: 3, apps: 5, activeCredentials: 7, activeUsers30d: 2, updatedAt: new Date().toISOString() };
const broken = process.argv[2] === "bad"; // ignores the category filter
http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const { query, variables } = JSON.parse(body);
      let data;
      if (query.includes("renownNetworkStats")) data = { renownNetworkStats: stats };
      else if (query.includes("appProfileCategories"))
        data = { appProfileCategories: [{ category: "DeFi", count: 3 }, { category: "Games", count: 1 }] };
      else {
        const cat = variables.category?.trim().toLowerCase();
        const list = apps.filter(([, c]) => !cat || broken || c?.toLowerCase() === cat);
        const start = variables.after ? Number(variables.after) : 0;
        const page = list.slice(start, start + variables.limit);
        const next = start + variables.limit < list.length ? String(start + variables.limit) : null;
        data = { appProfiles: { items: page.map(([appDid, category]) => ({ appDid, category })), next } };
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data }));
    });
  })
  .listen(Number(process.argv[3]));
```

Run:

```bash
node $TMP/fake-switchboard.mjs good 4555 & GOOD=$!
node $TMP/fake-switchboard.mjs bad 4556 & BAD=$!
node scripts/smoke/network-stats.ts --switchboard http://localhost:4555/graphql; echo "exit=$?"
node scripts/smoke/network-stats.ts --switchboard http://localhost:4556; echo "exit=$?"
kill $GOOD $BAD
```

Expected: the first run ends `[smoke] appProfiles(category) DEFI: 3 of 3 (unreadable profiles are skipped)`, `[smoke] OK`, `exit=0`; the second ends `[smoke] FAILED: appProfiles(category: DEFI) returned did:key:z2 with category Games`, `exit=1`. Against today's staging (`node scripts/smoke/network-stats.ts`) it fails with `Cannot query field "renownNetworkStats"` — expected until rollout.

- [ ] **Step 3: Document the smoke** — append to `scripts/smoke/README.md`:

````markdown

## network-stats.ts

Read-only check of the renown.id site-polish reads (`renownNetworkStats`,
`appProfileCategories`, `appProfiles(category)`) on a switchboard:

```sh
node scripts/smoke/network-stats.ts                                                  # Renown staging
node scripts/smoke/network-stats.ts --switchboard https://switchboard.renown.vetra.io # production
```

Anonymous queries only, so no `--allow-prod` and nothing to clean up. It
checks the network counts are non-negative integers with an ISO `updatedAt`
(and reports whether a second request hit the 300 s cache — several replicas
each keep their own), that categories are ordered count desc then name, that a
blank category equals no filter, and that the first category, asked in swapped
case, pages to the end with only matching profiles and at most its count.
Exits 1 on any failure.
````

- [ ] **Step 4: Document the reads** — in `subgraphs/renown-stats/README.md` replace the start of the paragraph

```markdown
Reads are public: `appProfile`, `appProfilesByPublisher` and `appProfiles(limit, after)` (newest first, `limit` 1–50, opaque `next` cursor).
```

with

```markdown
Reads are public: `appProfile`, `appProfilesByPublisher`, `appProfiles(limit, after, category)` (newest first, `limit` 1–50, opaque `next` cursor; `category` matches case-insensitively, blank = all), `appProfileCategories` and `renownNetworkStats`.
```

(keep the rest of that paragraph), and append at the end of the file:

```markdown

## Catalog and network reads (site polish)

`upsertAppProfile` copies the saved category into `app_profile_documents.category` (trimmed, null when none) in the same step as the image index; profiles from before this were copied once at startup (job `app-profile-category-backfill-v1` in `renown_stats_jobs`; retried on the next start until every profile document was read).

- `appProfiles(category)` filters on `lower(category)`; the cursor works within the same filter.
- `appProfileCategories` groups case-insensitively: `{ category, count }`, label = smallest spelling (byte order), ordered count desc then name; empty categories are left out.
- `renownNetworkStats`: `identities` = distinct lower-cased `eth_address` in `renown_user`; `apps` = app profiles; `activeCredentials` = distinct `credential_id` of `renown_credential` rows with `revoked = false` and `expiration_date` null or in the future; `activeUsers30d` = distinct users with any `app_metric_values` row updated in the last 30 days (all apps; the same source as `appStats.activeUsers30d`); `updatedAt` = when computed. Cached per replica for 300 s; concurrent requests share one computation; a failed read answers `SERVICE_UNAVAILABLE` and is not cached.
```

- [ ] **Step 5: Full verification**

Run: `npm run tsc` — expected: no output.
Run: `npm run lint 2>&1 | grep -E " error |renown-stats|scripts/smoke"` — expected: no output.
Run: `npx vitest run 2>&1 | grep -E "×|Test Files|Tests "` — expected: `Test Files 50 passed (50)`, `Tests 608 passed (608)`, no `×`.

- [ ] **Step 6: Commit**

```bash
git add scripts/smoke/network-stats.ts scripts/smoke/README.md subgraphs/renown-stats/README.md
git commit -m "chore(smoke): network-stats smoke for the site-polish reads; document them"
```

---

### Task 6: Rollout (controller)

Done by the controller, not by a task implementer. Staging first, then prod; the website (Phase B front end) ships only after step 5 passes on prod. The release workflow builds the `staging` branch for `channel=staging` and `main` for `channel=latest` (`.github/workflows/sync-and-publish.yml`, `prepare` job).

- [ ] **Step 1:** Push and get `feat/site-polish` into `staging` (PR or merge, controller's choice): `git push -u origin feat/site-polish`.
- [ ] **Step 2:** Release staging: `gh workflow run sync-and-publish.yml --ref main -f channel=staging -f sync=false`, then `gh run watch` on the new run; deploy the staging tenant per the hosting runbook.
- [ ] **Step 3:** Staging smoke: `node scripts/smoke/network-stats.ts` → `[smoke] OK`. Also check the switchboard log shows no `[renown-stats] category backfill … failed` warning (or a later start finished it) — a staging profile with a category must then appear in `appProfileCategories`.
- [ ] **Step 4:** Promote to `main`, then release prod: `gh workflow run sync-and-publish.yml --ref main -f channel=latest -f sync=false`, `gh run watch`; deploy the prod tenant.
- [ ] **Step 5:** Prod smoke: `node scripts/smoke/network-stats.ts --switchboard https://switchboard.renown.vetra.io` → `[smoke] OK`. Hand the numbers it prints to the website planner (they decide which pulse tiles clear `NEXT_PUBLIC_PULSE_MIN`).

---

## Self-Review

1. **Spec coverage.** Backend item 1 (`appProfiles` category, case-insensitive exact, blank = no filter, same paging/limits) → Tasks 1–3. Item 2 (`appProfileCategories`, non-empty, count desc then name) → Tasks 1, 3. Item 3 (`renownNetworkStats`, each definition, 300 s cache, `SERVICE_UNAVAILABLE`) → Tasks 1, 4. "All three are public reads" → no auth checks added (Tasks 3–4). Testing line "vitest for category filter (case, blank, paging with filter), categories aggregation, network stats (each count, expiry/revoked edges, cache, storage failure)" → `app-catalog`, `store-catalog`, `network-stats` tests. "Backend ships before the website" / "Staging first" → Task 6. Gap found and closed: the category was not indexed anywhere → rulings 1–2, Task 2 (heal + backfill).
2. **Placeholder scan.** Every code step carries complete code; no "TBD", "similar to", or undefined names.
3. **Type consistency.** `appProfilesPage(limit, after?, category?)`, `setAppCategory(appDid, category | null)`, `appProfileCategories(): AppCategoryCount[]`, `networkActivity(since): NetworkActivity { apps, activeUsers }`, `identityCount(db)`, `activeCredentialCount(db, now)`, `backfillAppCategories(deps)` / `CATEGORY_BACKFILL_JOB`, `NETWORK_STATS_TTL_MS`, harness `appProfiles` / `appProfileCategories` / `networkStats` / `NetworkStatsOut` are used with the same names and shapes in every task. The SDL in "Interfaces produced" is the exact text of Tasks 3–4.
4. **Review Focus.** All five lines have a pinned test in the owning task (Task 2 backfill; Tasks 1/3 case grouping; Task 3 blank/whitespace `it.each`; Task 4 failure-not-cached and shared computation; Task 4 `expiration: NOW`).

Verified while planning (scratch worktree of `feat/site-polish` at 46ed24e with all five tasks applied): `npm run tsc` clean, `npm run lint` 0 errors and no warnings in touched files, `npx vitest run` 50 files / 608 tests passed (`subgraphs/renown-stats`: 138 → 165), smoke script exercised against good and broken fake switchboards and today's staging.
