# Renown Organisations A3 — Integrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect organisations to people and systems: an in-app notification inbox, signed webhooks with retries, org-owned OIDC clients, abuse reports with platform moderation and handle release, the audit export, support/security contacts on app profiles, the framework-free SDK (`@powerhousedao/renown-package/orgs`) and a staging smoke script.

**Architecture:** Notifications and webhooks are activity sinks: A1 and A2 already describe every successful mutation once (`rt.record({ ..., event, notify })`); A3 registers two sinks on the runtime that turn those descriptions into `org_notifications` rows and queued `org_webhook_deliveries`, which the sweeper delivers through A2's SSRF guard with HMAC signatures. Org-owned OIDC clients reuse renown-oidc's registry functions against its own store. Moderation is a small area gated by `RENOWN_PLATFORM_ADMINS`. The SDK is the same `sdk/orgs.ts` the subgraph already imports, completed and built as its own package entry.

**Tech Stack:** TypeScript (nodenext, strict), Powerhouse 6.2.3 (`ph-cli generate` for the renown-app-profile change), Kysely 0.28 / Postgres (PGlite in tests), graphql-tag, WebCrypto + `node:crypto` HMAC, renown-workload's AES-256-GCM `seal`/`open`, vitest 4.1.1, oxlint, Node 24 for the smoke script.

**Spec:** `docs/superpowers/specs/2026-10-12-renown-organisations-design.md` — §3.7 (contacts), §3.8 (org-owned clients), §3.9 (webhooks), §3.10 (notifications), §3.11 (reports, moderation, handle disputes), §3.12 (audit export), §4.2–4.4 (subgraph surface, SDK helpers), §9 (testing and rollout). Read with the A1 plan (`2026-10-12-orgs-a1-core.md`: Rulings, API contract appendix) and the A2 plan (`2026-10-12-orgs-a2-security-apps.md`).

**Precondition:** A1 and A2 are merged on `feat/organisations` (`pnpm test` green; `tests/api-contract.test.ts` has `SHIPPED = ["A1", "A2"]`).

## Rulings (A3; A1 and A2 rulings still apply)

1. **Built-in sinks.** The runtime exposes its mutable sink list (`rt.sinks`); the notifications and webhooks areas register their sink once when their resolvers are built. A sink failure is logged and never fails the mutation (A1 ruling 9).
2. **Notification recipients** are resolved when the activity is recorded: `OWNERS` = ACTIVE owners, `ADMINS` = ACTIVE owners and admins, explicit addresses as given (lowercased). The actor is never notified of their own action; at most one row per recipient and kind per activity. The stored payload is the intent payload plus `orgId`. Retention is 90 days (daily prune job). `markNotificationsRead` takes exactly one of `ids` (only the caller's own rows change) or `all: true`, and returns how many rows became read.
3. **DELEGATION_ADDED** comes from a sweep job (every 5 minutes) that scans credentials created since the job's previous run whose subject is an org app and notifies that org's admins (system activity `system.delegationAdded`, no webhook event). The first run only records its time (no backfill). The sweeper therefore passes each job its previous run time.
4. **Webhook endpoints:** at most 10 per org; an `https` URL of at most 2048 characters without credentials whose resolved addresses are all public (checked at creation and again at every delivery); `events` is a non-empty subset of the 19 event types. The secret is 32 random bytes base64url, shown once, sealed with AES-256-GCM under `RENOWN_WORKLOAD_KEY_ENCRYPTION_KEY` (renown-workload's `seal`/`open`, the webhook id as additional data). Without that key, creating, rotating or testing webhooks answers `SERVICE_UNAVAILABLE`.
5. **Delivery:** `POST` with body `{"id","type","orgId","createdAt","data"}` (the event id is the activity's audit id), headers `content-type: application/json`, `user-agent: Renown-Webhooks/1` and `Renown-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>`. A 2xx is delivered; any other status, network error, guard refusal or timeout is a failed attempt. Attempts happen at once, then after 1 min, 5 min, 30 min, 2 h and 12 h; after the sixth failure the delivery is `FAILED`. Every failed attempt increments the endpoint's consecutive failures and every success resets them; at 50 the endpoint is disabled (system audit). Re-enabling resets the counter. Only the newest 100 deliveries per endpoint are kept. `testOrgWebhook` sends a `ping` (data `{}`) at once, a single attempt, and returns that delivery.
6. **Org-owned OIDC clients** are registered through renown-oidc's `registerClient` against the renown-oidc store (namespace `renown-oidc`) as confidential clients with `allowedSubjects: []`, `allowAnySubject: false`, `allowedOrgs: [{orgId, minRole: "MEMBER"}]`, and recorded in `org_oidc_clients`. Admins change name, redirect URIs and status and rotate the secret; `allowedOrgs` and `allowAnySubject` of an org-owned client are not changeable through renown-orgs. The secret never reaches the audit log.
7. **Reports and moderation.** Any signed-in address reports (`details` ≤ 1000 characters; 5 per reporter per rolling 24 h → `RATE_LIMITED`); reports are not written to the org's audit log (reporters stay private). Only platform admins (`RENOWN_PLATFORM_ADMINS`, default `ADMINS`) list and resolve; every resolution is audited on the org with the admin as actor. `TAKE_DOWN`/`RESTORE` set `takenDown`; `RELEASE_HANDLE` renames the org to `org-<first 8 characters of its id>` (lowercased; `-2`, `-3`… when taken) and reserves the old handle for 30 days with reason `RELEASED`; during that window only an org with a VERIFIED domain whose first label equals the handle may take it (through a CHANGE_HANDLE proposal).
8. **Audit export:** admins only, newest first, at most 10 000 entries, a JSON array of `{id, at, actor, action, details}` with `details` as objects.
9. **Contacts:** `supportContact` and `securityContact` on renown-app-profile v1 in place (JSON + codegen, like `listed`), each at most 200 characters, either an email address (stored without `mailto:`) or an `https` URL; `""` clears; validated by the reducer (`InvalidContactError`) and pre-validated by `upsertAppProfile` (`BAD_USER_INPUT` with the field name).
10. **SDK packaging:** `ph-cli build`'s entry list is fixed (`index.ts`, `document-models/**`, `editors/**`, `subgraphs/**`, `processors/**`), so `sdk/orgs.ts` (dependency-free) is compiled separately by `tsc -p sdk/tsconfig.json` into `dist/sdk/` after `ph-cli build`, and exported as `"./orgs"`. renown.id and Vetra may also copy the file; its vectors are pinned in tests.
11. **Smoke:** read-only checks by default (staging); `--write` needs `RENOWN_SMOKE_KEY` (a hex private key of a staging-only wallet) and works on the idempotent unlisted org `@renown-smoke-<first 6 hex of the address>`, cleaning up what it creates (invite link revoked, team deleted, webhook deleted). Non-staging hosts need `--allow-prod`.

## Global Constraints

- Conventional commits; **no `Co-Authored-By` or "Generated with" lines** in commits or PR descriptions.
- Never edit `gen/` by hand; renown-app-profile changes via its JSON + `pnpm generate document-model --document document-models/renown-app-profile/renown-app-profile.json`, restoring generator side effects outside `gen/`, `schema.graphql` and the JSON.
- Reducers pure; reducer coverage ≥ 95 % on lines, branches, functions, statements.
- After every task: `pnpm tsc`, `pnpm lint`, `pnpm test` green; keep output short.
- Error codes only from the fixed list; webhook secrets and OIDC client secrets are shown once and never logged or audited.
- When a step appends code that begins with `import` lines to an existing file, move those imports up to the file's other imports.
- Staging first, then main/prod.

## Review Focus

1. **A webhook URL that resolved to a public address at creation and to a private one later** (DNS rebinding over time). Expected: that delivery is refused before any connection and counts as a failed attempt. Pinned in Task 2 ("refuses a delivery whose host now resolves privately").
2. **A replayed or tampered webhook** at a receiver using the SDK. Expected: `verifyWebhookSignature` rejects a body change, a wrong secret, a timestamp outside 300 s and malformed headers, and accepts any of several `v1=` values. Pinned in Task 6.
3. **The actor of an action, or a person named twice** (an owner who is also the explicit recipient). Expected: no notification to the actor, exactly one row per recipient and kind. Pinned in Task 1.
4. **`markNotificationsRead` with another wallet's notification ids.** Expected: 0 rows change. Pinned in Task 1.
5. **A released handle claimed during its window by an org without the matching verified domain.** Expected: `HANDLE_RESERVED`; the org with `<handle>.<tld>` verified succeeds. Pinned in Task 4.

## File Structure

| File | Responsibility |
| --- | --- |
| `subgraphs/renown-orgs/store/{types,migrations,kysely}.ts` | notifications, webhooks, deliveries, OIDC client links, reports |
| `subgraphs/renown-orgs/schema-integrations.ts`, `schema.ts` | A3 SDL |
| `subgraphs/renown-orgs/runtime.ts` | `sinks`, `webhookKey`, `oidc` deps |
| `subgraphs/renown-orgs/core/sweeper.ts`, `jobs.ts` | previous run passed to jobs; prune, delegation, delivery jobs |
| `subgraphs/renown-orgs/areas/notifications.ts` | inbox and its sink |
| `subgraphs/renown-orgs/core/webhook-delivery.ts`, `areas/webhooks.ts` | signing, delivery, retries; endpoint CRUD and its sink |
| `subgraphs/renown-orgs/areas/oidc-clients.ts` | org-owned OIDC clients |
| `subgraphs/renown-orgs/areas/moderation.ts`, `core/handles.ts` | reports, resolutions, handle release window; audit export |
| `document-models/renown-app-profile/**`, `subgraphs/renown-stats/**` | contacts |
| `sdk/orgs.ts`, `sdk/tsconfig.json`, `package.json` | SDK helpers and packaging |
| `scripts/smoke/organisations.ts`, `scripts/smoke/README.md` | staging smoke |

---

### Task 1: Notifications — sink, inbox queries, mark read, retention, DELEGATION_ADDED

**Files:**
- Modify: `subgraphs/renown-orgs/runtime.ts` (`sinks`), `core/sweeper.ts` (previous run), `jobs.ts`, `store/{types,migrations,kysely}.ts`, `store/foreign.ts` (`credentialsCreatedBetween`), `schema.ts`, `resolvers.ts`, `tests/harness.ts` (`insertCredential` `createdAt`), `tests/api-contract.test.ts` (nothing yet)
- Create: `subgraphs/renown-orgs/schema-integrations.ts`, `areas/notifications.ts`
- Test: `subgraphs/renown-orgs/tests/notifications.test.ts`, `tests/store-contract.ts` (append)

**Interfaces:**
- Consumes: A1 activity vocabulary (`OrgActivity.notify`, `ActivitySink`, `RecordedActivity`), `orgSummaries`, A2 sweeper and `orgOfApp`.
- Produces:
  - runtime: `OrgRuntime.sinks: ActivitySink[]` (mutable; areas push built-in sinks).
  - sweeper: `SweepJob.run(now: Date, previous: Date | null)`.
  - store: `interface NotificationRecord { id; recipient; kind; orgId; payload; createdAt; readAt }`, `insertNotifications(rows)`, `notificationsPage(recipient, { unreadOnly, limit, after? })` (newest first), `unreadNotificationCount(recipient)`, `markNotificationsRead(recipient, ids | "ALL", now): Promise<number>`, `pruneNotifications(before): Promise<number>`.
  - `store/foreign.ts`: `credentialsCreatedBetween(db, from, to, limit)`.
  - `areas/notifications.ts`: `notificationResolvers: Area`, `notificationSink(rt): ActivitySink`, `NOTIFICATION_RETENTION_DAYS = 90`; `jobs.ts`: `notificationsPruneJob(rt)`, `delegationsJob(rt)`.
  - `schema-integrations.ts`: `NOTIFICATIONS_SDL`, `INTEGRATIONS_SDL`.

- [ ] **Step 1: Write the failing tests**

In `subgraphs/renown-orgs/tests/harness.ts`, `insertCredential` takes `createdAt?: Date` and inserts `created_at: row.createdAt ?? T0` (add both to its parameter type and its `values`).

Append inside `describeOrgStoreContract` in `subgraphs/renown-orgs/tests/store-contract.ts`:

```ts
    it("keeps notifications per recipient, pages them, marks only the recipient's own as read, prunes old ones", async () => {
      const { store } = await open();
      const note = (id: string, recipient: string, createdAt: Date) => ({ id, recipient, kind: "INVITED", orgId: "o1", payload: { n: id }, createdAt, readAt: null });
      await store.insertNotifications([note("n1", ALICE, T0), note("n2", ALICE, at(1)), note("n3", ALICE, at(2)), note("n4", BOB, at(2))]);
      expect((await store.notificationsPage(ALICE, { unreadOnly: false, limit: 2 })).map((n) => n.id)).toEqual(["n3", "n2"]);
      expect((await store.notificationsPage(ALICE, { unreadOnly: false, limit: 5, after: { createdAt: at(1), id: "n2" } })).map((n) => n.id)).toEqual(["n1"]);
      expect(await store.unreadNotificationCount(ALICE)).toBe(3);
      expect(await store.markNotificationsRead(ALICE, ["n1", "n4"], at(3))).toBe(1);
      expect(await store.markNotificationsRead(ALICE, ["n1"], at(4))).toBe(0);
      expect((await store.notificationsPage(ALICE, { unreadOnly: true, limit: 5 })).map((n) => n.id)).toEqual(["n3", "n2"]);
      expect(await store.markNotificationsRead(ALICE, "ALL", at(5))).toBe(2);
      expect(await store.unreadNotificationCount(BOB)).toBe(1);
      expect(await store.pruneNotifications(at(2))).toBe(2);
      expect((await store.notificationsPage(ALICE, { unreadOnly: false, limit: 5 })).map((n) => n.id)).toEqual(["n3"]);
    });
```

Create `subgraphs/renown-orgs/tests/notifications.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createSweeper } from "../core/sweeper.js";
import { sweepJobs } from "../jobs.js";
import { ALICE, BOB, CAROL, addOwner, createOrg, failure, harnessResolvers, insertCredential, join, lower, openHarness, resetHarness, T0, type Harness, type TestResolvers } from "./harness.js";

vi.mock("../../renown-auth/core/smart-wallet.js", () => ({
  verifyMessageOnChain: () => Promise.resolve(false),
  verifyTypedDataOnChain: () => Promise.resolve(false),
}));

const APP = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
interface Note {
  id: string;
  kind: string;
  orgId: string;
  org: { handle: string } | null;
  payload: string;
  readAt: string | null;
}
type Page = { items: Note[]; next: string | null };
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

const inbox = (t: TestResolvers, who: typeof ALICE, args: Record<string, unknown> = {}) => t.query<Page>("myNotifications", args, who);

describe("notifications", () => {
  it("notifies the invitee, then the admins (never the actor), once per recipient", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    await join(t, id, CAROL, "ADMIN");
    const invite = await t.mutate<{ id: string }>("inviteOrgMember", { orgId: id, invitee: BOB.address, role: "MEMBER" }, ALICE);
    expect((await inbox(t, BOB)).items.map((n) => [n.kind, n.org?.handle, JSON.parse(n.payload)])).toEqual([
      ["INVITED", "acme", { inviteId: invite.id, role: "MEMBER", orgId: id }],
    ]);
    await t.mutate("respondToOrgInvite", { orgId: id, inviteId: invite.id, accept: true }, BOB);
    // Newest first: BOB accepted after CAROL.
    expect((await inbox(t, ALICE)).items.filter((n) => n.kind === "INVITE_ACCEPTED").map((n) => JSON.parse(n.payload).address)).toEqual([
      lower(BOB),
      lower(CAROL),
    ]);
    expect((await inbox(t, CAROL)).items.filter((n) => n.kind === "INVITE_ACCEPTED")).toHaveLength(1);
    expect((await inbox(t, BOB)).items.filter((n) => n.kind === "INVITE_ACCEPTED")).toEqual([]);
    expect(await t.query("myUnreadNotificationCount", {}, ALICE)).toBe(2);
  });

  it("fans proposals out to the owners except the proposer", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    await addOwner(t, id, BOB);
    await join(t, id, CAROL, "MEMBER");
    await t.mutate("proposeOrgChange", { orgId: id, kind: "ADD_OWNER", payload: { address: CAROL.address } }, ALICE);
    expect((await inbox(t, BOB)).items.slice(0, 2).map((n) => n.kind).sort()).toEqual(["PROPOSAL_CREATED", "PROPOSAL_NEEDS_APPROVAL"]);
    expect((await inbox(t, ALICE)).items.filter((n) => n.kind.startsWith("PROPOSAL_") && JSON.parse(n.payload).kind === "ADD_OWNER" && n.kind !== "PROPOSAL_EXECUTED")).toEqual([]);
  });

  it("marks read by ids (own only) or all, pages, and validates arguments", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    for (const who of [BOB, CAROL]) await t.mutate("inviteOrgMember", { orgId: id, invitee: who.address, role: "MEMBER" }, ALICE);
    const [bobNote] = (await inbox(t, BOB)).items;
    const [carolNote] = (await inbox(t, CAROL)).items;
    expect(await t.mutate("markNotificationsRead", { ids: [carolNote.id] }, BOB)).toBe(0);
    expect(await t.mutate("markNotificationsRead", { ids: [bobNote.id] }, BOB)).toBe(1);
    expect((await inbox(t, BOB, { unreadOnly: true })).items).toEqual([]);
    expect(await t.mutate("markNotificationsRead", { all: true }, CAROL)).toBe(1);
    expect(await failure(t.mutate("markNotificationsRead", {}, CAROL))).toMatchObject({ field: "ids" });
    expect(await failure(t.mutate("markNotificationsRead", { ids: ["x"], all: true }, CAROL))).toMatchObject({ field: "ids" });
    expect(await failure(inbox(t, BOB, { limit: 0 }))).toMatchObject({ field: "limit" });
    expect((await failure(t.query("myNotifications", {}))).code).toBe("FORBIDDEN");
  });

  it("prunes notifications older than 90 days and tells admins about new delegations for org apps", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    await join(t, id, BOB, "PUBLISHER");
    await t.store.insertOrgApp({ appDid: APP, orgId: id, frozen: false, addedAt: T0 });
    const sweeper = createSweeper({ jobs: sweepJobs(t.rt), store: () => t.store, now: () => t.clock.now });
    await sweeper.tick();
    await insertCredential(h, { credentialId: "c1", issuer: lower(BOB), appDid: APP, createdAt: new Date(T0.getTime() + MINUTE) });
    await insertCredential(h, { credentialId: "c2", issuer: lower(BOB), appDid: "did:key:zDnaerDaTF5BXEavCrfRZEk316dpbLsfPDZ3WJ5hRTPFU2169", createdAt: new Date(T0.getTime() + MINUTE) });
    t.tick(5 * MINUTE);
    await sweeper.tick();
    expect((await inbox(t, ALICE)).items.filter((n) => n.kind === "DELEGATION_ADDED").map((n) => JSON.parse(n.payload))).toEqual([
      { credentialId: "c1", appDid: APP, issuer: lower(BOB), orgId: id },
    ]);
    t.tick(91 * DAY);
    await sweeper.tick();
    expect((await inbox(t, BOB)).items).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run subgraphs/renown-orgs 2>&1 | grep -E "Tests |FAIL" | head -6`
Expected: `insertNotifications is not a function`; `myNotifications` is not a resolver.

- [ ] **Step 3: Runtime sinks and the sweeper's previous run**

In `subgraphs/renown-orgs/runtime.ts`: add `readonly sinks: ActivitySink[];` to `OrgRuntime` (doc: "Activity sinks; built-in areas append theirs once"); in `createRuntime` replace `const record = createActivityRecorder({ store, newId, sinks: deps.sinks ?? [] });` with

```ts
  const sinks: ActivitySink[] = [...(deps.sinks ?? [])];
  const record = createActivityRecorder({ store, newId, sinks });
```

and add `sinks,` to the returned object.

In `subgraphs/renown-orgs/core/sweeper.ts`: `SweepJob.run` becomes `run(now: Date, previous: Date | null): Promise<void>;` (doc: "previous: when the job last started, or null on its first run") and the call becomes `await job.run(now, claim.previous);`.

- [ ] **Step 4: Store**

`subgraphs/renown-orgs/store/types.ts`:

```ts
export interface OrgNotificationsTable {
  id: string;
  recipient: string;
  kind: string;
  org_id: string;
  payload: JsonColumn;
  created_at: Timestamp;
  read_at: Timestamp | null;
}

export interface NotificationRecord {
  id: string;
  /** Lowercase address. */
  recipient: string;
  kind: string;
  orgId: string;
  payload: Record<string, unknown>;
  createdAt: Date;
  readAt: Date | null;
}
```

`org_notifications: OrgNotificationsTable;` in `OrgsDB`; `OrgStore` gains:

```ts
  insertNotifications(rows: readonly NotificationRecord[]): Promise<void>;
  /** Newest first, strictly after the cursor. */
  notificationsPage(recipient: string, options: { unreadOnly: boolean; limit: number; after?: { createdAt: Date; id: string } }): Promise<NotificationRecord[]>;
  unreadNotificationCount(recipient: string): Promise<number>;
  /** Marks the recipient's unread notifications (`ids`, or every one) read; returns how many changed. */
  markNotificationsRead(recipient: string, ids: readonly string[] | "ALL", now: Date): Promise<number>;
  /** Deletes notifications created before `before`; returns how many. */
  pruneNotifications(before: Date): Promise<number>;
```

Migration (append):

```ts
  // A3: the in-app inbox.
  await db.schema
    .createTable("org_notifications")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("recipient", "text", (col) => col.notNull())
    .addColumn("kind", "text", (col) => col.notNull())
    .addColumn("org_id", "text", (col) => col.notNull())
    .addColumn("payload", "jsonb", (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn("created_at", "timestamptz", (col) => col.notNull())
    .addColumn("read_at", "timestamptz")
    .execute();
  await db.schema.createIndex("org_notifications_recipient").ifNotExists().on("org_notifications").columns(["recipient", "created_at", "id"]).execute();
  await db.schema.createIndex("org_notifications_created").ifNotExists().on("org_notifications").column("created_at").execute();
```

`KyselyOrgStore` (and `import type { NotificationRecord, OrgNotificationsTable }`):

```ts
  async insertNotifications(rows: readonly NotificationRecord[]): Promise<void> {
    if (rows.length === 0) return;
    await this.db
      .insertInto("org_notifications")
      .values(
        rows.map((row) => ({
          id: row.id,
          recipient: row.recipient.toLowerCase(),
          kind: row.kind,
          org_id: row.orgId,
          payload: JSON.stringify(row.payload),
          created_at: row.createdAt,
          read_at: row.readAt,
        })),
      )
      .execute();
  }

  async notificationsPage(
    recipient: string,
    options: { unreadOnly: boolean; limit: number; after?: { createdAt: Date; id: string } },
  ): Promise<NotificationRecord[]> {
    let query = this.db.selectFrom("org_notifications").selectAll().where("recipient", "=", recipient.toLowerCase());
    if (options.unreadOnly) query = query.where("read_at", "is", null);
    const after = options.after;
    if (after) {
      query = query.where((eb) =>
        eb.or([eb("created_at", "<", after.createdAt), eb.and([eb("created_at", "=", after.createdAt), eb("id", "<", after.id)])]),
      );
    }
    const rows = await query.orderBy("created_at", "desc").orderBy("id", "desc").limit(options.limit).execute();
    return rows.map((row: Selectable<OrgNotificationsTable>) => ({
      id: row.id,
      recipient: row.recipient,
      kind: row.kind,
      orgId: row.org_id,
      payload: jsonValue<Record<string, unknown>>(row.payload, {}),
      createdAt: toDate(row.created_at),
      readAt: toDateOrNull(row.read_at),
    }));
  }

  async unreadNotificationCount(recipient: string): Promise<number> {
    const row = await this.db
      .selectFrom("org_notifications")
      .select(sql<number>`count(*)::int`.as("n"))
      .where("recipient", "=", recipient.toLowerCase())
      .where("read_at", "is", null)
      .executeTakeFirstOrThrow();
    return Number(row.n);
  }

  async markNotificationsRead(recipient: string, ids: readonly string[] | "ALL", now: Date): Promise<number> {
    if (ids !== "ALL" && ids.length === 0) return 0;
    let query = this.db
      .updateTable("org_notifications")
      .set({ read_at: now })
      .where("recipient", "=", recipient.toLowerCase())
      .where("read_at", "is", null);
    if (ids !== "ALL") query = query.where("id", "in", [...ids]);
    const result = await query.executeTakeFirst();
    return Number(result.numUpdatedRows);
  }

  async pruneNotifications(before: Date): Promise<number> {
    const result = await this.db.deleteFrom("org_notifications").where("created_at", "<", before).executeTakeFirst();
    return Number(result.numDeletedRows);
  }
```

Append to `subgraphs/renown-orgs/store/foreign.ts`:

```ts
/** Credentials created in (from, to], oldest first, at most `limit`. */
export async function credentialsCreatedBetween(db: ReadModelDb, from: Date, to: Date, limit: number): Promise<CredentialRow[]> {
  const rows = await credentials(db)
    .select([...CREDENTIAL_COLUMNS])
    .where("created_at", ">", from)
    .where("created_at", "<=", to)
    .orderBy("created_at")
    .limit(limit)
    .execute();
  return rows.map(toCredential);
}
```

- [ ] **Step 5: SDL, the area and its sink, the jobs**

Create `subgraphs/renown-orgs/schema-integrations.ts`:

```ts
/** A3 SDL, one block per area; each block extends the A1 root types. */
export const NOTIFICATIONS_SDL = `
  enum OrgNotificationKind {
    INVITED
    INVITE_ACCEPTED
    ROLE_CHANGED
    REMOVED
    PROPOSAL_CREATED
    PROPOSAL_NEEDS_APPROVAL
    PROPOSAL_EXECUTED
    PROPOSAL_CANCELLED
    RECOVERY_STARTED
    APP_TRANSFER_REQUEST
    APP_TRANSFER_DONE
    APP_FROZEN
    DOMAIN_LAPSED
    DELEGATION_ADDED
  }

  type OrgNotification {
    id: String!
    kind: OrgNotificationKind!
    orgId: String!
    "Null when the organisation is gone or taken down"
    org: OrgSummary
    "JSON object"
    payload: String!
    createdAt: String!
    readAt: String
  }

  type OrgNotificationPage {
    items: [OrgNotification!]!
    next: String
  }

  extend type Query {
    "The caller's notifications, newest first; limit 1-50 (default 20)."
    myNotifications(unreadOnly: Boolean, limit: Int, after: String, auth: OrgAuthInput): OrgNotificationPage!
    myUnreadNotificationCount(auth: OrgAuthInput): Int!
  }

  extend type Mutation {
    "Exactly one of ids (the caller's own) and all: true. Returns how many became read."
    markNotificationsRead(ids: [String!], all: Boolean, auth: OrgAuthInput): Int!
  }
`;

/** Every A3 block; later tasks append theirs. */
export const INTEGRATIONS_SDL = [NOTIFICATIONS_SDL].join("\n");
```

and in `subgraphs/renown-orgs/schema.ts` build the schema from `[CORE_SDL, SECURITY_SDL, INTEGRATIONS_SDL]`.

Create `subgraphs/renown-orgs/areas/notifications.ts`:

```ts
import type { ActivitySink } from "../core/activity.js";
import type { OrgArgs, OrgContext } from "../core/auth.js";
import { isAdminRole } from "../core/authz.js";
import { badInput } from "../core/errors.js";
import { iso, isoOrNull, orgSummaries } from "../output.js";
import type { Area, OrgRuntime } from "../runtime.js";
import type { NotificationRecord } from "../store/types.js";

export const NOTIFICATION_RETENTION_DAYS = 90;

/** Turns an activity's notification intents into inbox rows (never for the actor; once per recipient and kind). */
export function notificationSink(rt: OrgRuntime): ActivitySink {
  return async (activity) => {
    if (!activity.notify?.length) return;
    const store = rt.store();
    const active = await store.members(activity.orgId, ["ACTIVE"]);
    const rows: NotificationRecord[] = [];
    const seen = new Set<string>();
    for (const intent of activity.notify) {
      const recipients =
        intent.to === "OWNERS"
          ? active.filter((m) => m.role === "OWNER").map((m) => m.address)
          : intent.to === "ADMINS"
            ? active.filter((m) => isAdminRole(m.role)).map((m) => m.address)
            : intent.to.map((address) => address.toLowerCase());
      for (const recipient of recipients) {
        const key = `${recipient}\u0000${intent.kind}`;
        if (recipient === activity.actor || seen.has(key)) continue;
        seen.add(key);
        rows.push({
          id: rt.newId(),
          recipient,
          kind: intent.kind,
          orgId: activity.orgId,
          payload: { ...(intent.payload ?? {}), orgId: activity.orgId },
          createdAt: activity.at,
          readAt: null,
        });
      }
    }
    await store.insertNotifications(rows);
  };
}

function cursorOf(raw: string): { createdAt: Date; id: string } {
  try {
    const cursor = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as { c?: unknown; i?: unknown };
    const createdAt = typeof cursor.c === "string" ? new Date(cursor.c) : new Date(Number.NaN);
    if (Number.isNaN(createdAt.getTime()) || typeof cursor.i !== "string") throw new Error("malformed");
    return { createdAt, id: cursor.i };
  } catch {
    throw badInput("after", "after is not a cursor from myNotifications");
  }
}

export const notificationResolvers: Area = (rt) => {
  rt.sinks.push(notificationSink(rt));
  return {
    Query: {
      myNotifications: async (_: unknown, args: OrgArgs & { unreadOnly?: boolean | null; limit?: number | null; after?: string | null }, ctx: OrgContext) => {
        const caller = await rt.caller(ctx, "myNotifications", args);
        const limit = args.limit ?? 20;
        if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw badInput("limit", "limit must be an integer from 1 to 50");
        const store = rt.store();
        const rows = await store.notificationsPage(caller, {
          unreadOnly: args.unreadOnly === true,
          limit: limit + 1,
          after: args.after != null ? cursorOf(args.after) : undefined,
        });
        const page = rows.slice(0, limit);
        const orgs = await orgSummaries(rt, await store.organizationsByIds([...new Set(page.map((n) => n.orgId))]));
        const last = page.at(-1);
        return {
          items: page.map((n) => ({
            id: n.id,
            kind: n.kind,
            orgId: n.orgId,
            org: orgs.get(n.orgId) ?? null,
            payload: JSON.stringify(n.payload),
            createdAt: iso(n.createdAt),
            readAt: isoOrNull(n.readAt),
          })),
          next: rows.length > limit && last ? Buffer.from(JSON.stringify({ c: iso(last.createdAt), i: last.id })).toString("base64url") : null,
        };
      },
      myUnreadNotificationCount: async (_: unknown, args: OrgArgs, ctx: OrgContext) => {
        const caller = await rt.caller(ctx, "myUnreadNotificationCount", args);
        return rt.store().unreadNotificationCount(caller);
      },
    },
    Mutation: {
      markNotificationsRead: async (_: unknown, args: OrgArgs & { ids?: string[] | null; all?: boolean | null }, ctx: OrgContext) => {
        const caller = await rt.writer(ctx, "markNotificationsRead", args);
        const all = args.all === true;
        if ((args.ids != null) === all) throw badInput("ids", "Pass exactly one of ids and all: true");
        return rt.store().markNotificationsRead(caller, all ? "ALL" : (args.ids ?? []), rt.now());
      },
    },
  };
};
```

(`orgSummaries` marks taken-down orgs by emptying their avatar and domains; the inbox shows `org: null` only for an org that no longer exists.)

Append to `subgraphs/renown-orgs/jobs.ts` (and add both to `sweepJobs`):

```ts
const DAY_MS = 24 * HOUR_MS;

/** Daily: deletes notifications older than the retention period. */
export function notificationsPruneJob(rt: OrgRuntime): SweepJob {
  return {
    name: "notifications-prune",
    everyMs: DAY_MS,
    async run(now) {
      await rt.store().pruneNotifications(new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * DAY_MS));
    },
  };
}

/** Every 5 minutes: tells an organisation's admins about delegations created for its apps since the last run. */
export function delegationsJob(rt: OrgRuntime): SweepJob {
  return {
    name: "delegations",
    everyMs: 5 * MINUTE_MS,
    async run(now, previous) {
      if (!previous) return;
      for (const row of await credentialsCreatedBetween(rt.deps.relationalDb, previous, now, 500)) {
        const app = await rt.store().orgOfApp(row.appDid);
        if (!app) continue;
        const payload = { credentialId: row.credentialId, appDid: row.appDid, issuer: row.issuer };
        await rt.record({
          orgId: app.orgId,
          actor: "system",
          action: "system.delegationAdded",
          at: now,
          details: payload,
          notify: [{ to: "ADMINS", kind: "DELEGATION_ADDED", payload }],
        });
      }
    },
  };
}
```

(imports: `NOTIFICATION_RETENTION_DAYS` from `./areas/notifications.js`, `credentialsCreatedBetween` from `./store/foreign.js`.)

Register `notificationResolvers` in `AREAS`.

- [ ] **Step 6: Run the suite, types, lint**

Run: `pnpm vitest run subgraphs/renown-orgs 2>&1 | grep -E "Test Files|Tests |FAIL"`
Expected: all pass (the API contract accepts the partial A3 surface).

Run: `pnpm tsc 2>&1 | tail -3 && pnpm lint 2>&1 | tail -3`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add subgraphs/renown-orgs
git commit -m "feat(orgs): notification inbox with retention and delegation alerts"
```

---

### Task 2: Webhooks — endpoints, sealed secrets, signed deliveries, retries, auto-disable

**Files:**
- Modify: `subgraphs/renown-orgs/store/{types,migrations,kysely}.ts`, `runtime.ts` (`webhookKey`), `schema-integrations.ts` (`WEBHOOKS_SDL`), `resolvers.ts`, `jobs.ts` (`webhookDeliveryJob`)
- Create: `subgraphs/renown-orgs/core/webhook-delivery.ts`, `subgraphs/renown-orgs/areas/webhooks.ts`
- Test: `subgraphs/renown-orgs/tests/webhooks.test.ts`, `tests/store-contract.ts` (append)

**Interfaces:**
- Consumes: A2 `guardedRequest`, `isPublicAddress`, `NetGuardError`, `rt.net()`; renown-workload `seal`/`open` (`subgraphs/renown-workload/core/crypto.ts`) and `loadConfig` (`subgraphs/renown-workload/core/config.ts`); A1 `ORG_WEBHOOK_EVENTS`.
- Produces:
  - store: `type DeliveryStatus`, `interface WebhookRecord`, `type WebhookPatch`, `interface DeliveryRecord`, `type DeliveryPatch`, `insertWebhook`, `webhook(id)`, `webhooks(orgId)`, `updateWebhook(id, patch, now)`, `deleteWebhook(id)` (and its deliveries), `insertDeliveries(rows)`, `deliveries(webhookId, limit)` (newest first), `dueDeliveries(now, limit)`, `updateDelivery(id, patch)`, `pruneDeliveries(webhookId, keep)`.
  - runtime: `OrgsResolverDeps.webhookKey?: () => Uint8Array | null` (default: `RENOWN_WORKLOAD_KEY_ENCRYPTION_KEY`), `OrgRuntime.webhookKey(): Uint8Array | null`.
  - `core/webhook-delivery.ts`: `RETRY_DELAYS_MS`, `MAX_ATTEMPTS = 6`, `AUTO_DISABLE_AFTER = 50`, `KEEP_DELIVERIES = 100`, `MAX_WEBHOOKS = 10`, `eventBody(event)`, `signatureHeader(secret, body, at)`, `attemptDelivery(rt, delivery, { retry })`.
  - `areas/webhooks.ts`: `webhookResolvers: Area`, `webhookSink(rt)`; `jobs.ts`: `webhookDeliveryJob(rt)`.
  - Vector (pinned in Task 6): secret `whsec-test`, time `2026-10-12T12:00:00.000Z` (t = 1791806400), body `{"id":"e1","type":"ping","orgId":"o1","createdAt":"2026-10-12T12:00:00.000Z","data":{}}` → `Renown-Signature: t=1791806400,v1=d75d85f23b7a86faf73cdd020c6fa4436f53a1b646e17bc80d97e2299b4f4d17`.

- [ ] **Step 1: Write the failing tests**

Append inside `describeOrgStoreContract` in `subgraphs/renown-orgs/tests/store-contract.ts`:

```ts
    it("keeps webhooks and their deliveries, newest deliveries first, due ones, pruned to a count", async () => {
      const { store } = await open();
      await store.insertWebhook({ id: "w1", orgId: "o1", url: "https://h.example/hook", events: ["member.invited"], secretSealed: "v1.x.y", enabled: true, consecutiveFailures: 0, createdAt: T0, updatedAt: T0 });
      const delivery = (id: string, createdAt: Date, nextAttemptAt: Date | null, status: "PENDING" | "DELIVERED" = "PENDING") => ({
        id, webhookId: "w1", orgId: "o1", eventId: `e-${id}`, eventType: "member.invited", body: "{}", status, attempts: 0,
        responseStatus: null, lastError: null, createdAt, nextAttemptAt, deliveredAt: null,
      });
      await store.insertDeliveries([delivery("d1", T0, T0), delivery("d2", at(1), at(5)), delivery("d3", at(2), null, "DELIVERED")]);
      expect((await store.dueDeliveries(at(1), 10)).map((d) => d.id)).toEqual(["d1"]);
      expect(await store.updateDelivery("d1", { status: "FAILED", attempts: 6, lastError: "boom", nextAttemptAt: null })).toMatchObject({ status: "FAILED", attempts: 6 });
      expect((await store.deliveries("w1", 10)).map((d) => d.id)).toEqual(["d3", "d2", "d1"]);
      expect(await store.updateWebhook("w1", { consecutiveFailures: 3, enabled: false }, at(1))).toMatchObject({ consecutiveFailures: 3, enabled: false });
      await store.pruneDeliveries("w1", 2);
      expect((await store.deliveries("w1", 10)).map((d) => d.id)).toEqual(["d3", "d2"]);
      expect((await store.webhooks("o1")).map((w) => w.id)).toEqual(["w1"]);
      expect(await store.deleteWebhook("w1")).toBe(true);
      expect(await store.deliveries("w1", 10)).toEqual([]);
    });
```

Create `subgraphs/renown-orgs/tests/webhooks.test.ts`:

```ts
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { NetDeps, PinnedRequest } from "../core/net.js";
import { createSweeper } from "../core/sweeper.js";
import { sweepJobs } from "../jobs.js";
import { ALICE, BOB, createOrg, failure, harnessResolvers, join, openHarness, resetHarness, T0, type Harness, type TestResolvers } from "./harness.js";

vi.mock("../../renown-auth/core/smart-wallet.js", () => ({
  verifyMessageOnChain: () => Promise.resolve(false),
  verifyTypedDataOnChain: () => Promise.resolve(false),
}));

const MINUTE = 60_000;
const KEY = new Uint8Array(32).fill(9);
interface Webhook {
  id: string;
  url: string;
  events: string[];
  enabled: boolean;
  consecutiveFailures: number;
}
interface Delivery {
  id: string;
  eventType: string;
  status: string;
  attempts: number;
  responseStatus: number | null;
  lastError: string | null;
  nextAttemptAt: string | null;
}
let h: Harness;

/** A receiver: every host resolves to `ip`, every request answers `status`. */
function receiver() {
  const state = { ip: "93.184.216.34", status: 200 };
  const requests: PinnedRequest[] = [];
  const net: NetDeps = {
    lookup: () => Promise.resolve([{ address: state.ip, family: 4 }]),
    resolveTxt: () => Promise.reject(new Error("ENODATA")),
    request: (request) => {
      requests.push(request);
      return Promise.resolve({ status: state.status, body: new Uint8Array(), truncated: false });
    },
  };
  return { state, requests, net };
}

beforeAll(async () => {
  h = await openHarness();
});
afterAll(async () => {
  await h.root.destroy();
});
beforeEach(async () => {
  await resetHarness(h);
});

async function endpoint(t: TestResolvers, orgId: string, events = ["member.invited"]) {
  return t.mutate<{ webhook: Webhook; secret: string }>("createOrgWebhook", { orgId, url: "https://hooks.example/renown", events }, ALICE);
}

function sweep(t: TestResolvers) {
  return createSweeper({ jobs: sweepJobs(t.rt), store: () => t.store, now: () => t.clock.now }).tick();
}

describe("webhooks", () => {
  it("shows the secret once, keeps it sealed, and delivers signed events the endpoint subscribed to", async () => {
    const r = receiver();
    const t = harnessResolvers(h, { net: r.net, webhookKey: () => KEY });
    const { id } = await createOrg(t, ALICE, "acme");
    const { webhook, secret } = await endpoint(t, id);
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = await t.store.webhook(webhook.id);
    expect(stored?.secretSealed).toMatch(/^v1\./);
    expect(JSON.stringify(stored)).not.toContain(secret);
    expect(JSON.stringify(await t.store.auditPage(id, 5))).not.toContain(secret);
    await t.mutate("inviteOrgMember", { orgId: id, invitee: BOB.address, role: "MEMBER" }, ALICE);
    await t.mutate("setOrgListed", { orgId: id, listed: true }, ALICE);
    await sweep(t);
    expect(r.requests).toHaveLength(1);
    const [request] = r.requests;
    expect(request).toMatchObject({ method: "POST", address: "93.184.216.34" });
    expect(request.url.href).toBe("https://hooks.example/renown");
    const body = JSON.parse(request.body ?? "") as { id: string; type: string; orgId: string; createdAt: string; data: unknown };
    expect(body).toMatchObject({ type: "member.invited", orgId: id, createdAt: T0.toISOString(), data: { address: BOB.address.toLowerCase(), role: "MEMBER" } });
    const t0 = Math.floor(t.clock.now.getTime() / 1000);
    expect(request.headers["renown-signature"]).toBe(`t=${t0},v1=${createHmac("sha256", secret).update(`${t0}.${request.body}`).digest("hex")}`);
    expect(request.headers["user-agent"]).toBe("Renown-Webhooks/1");
    const [delivery] = await t.query<Delivery[]>("orgWebhookDeliveries", { orgId: id, webhookId: webhook.id }, ALICE);
    expect(delivery).toMatchObject({ eventType: "member.invited", status: "DELIVERED", attempts: 1, responseStatus: 200 });
  });

  it("retries at 1 min, 5 min, 30 min, 2 h and 12 h, then fails; 50 failures in a row disable the endpoint", async () => {
    const r = receiver();
    r.state.status = 500;
    const t = harnessResolvers(h, { net: r.net, webhookKey: () => KEY });
    const { id } = await createOrg(t, ALICE, "acme");
    const { webhook } = await endpoint(t, id);
    await t.mutate("inviteOrgMember", { orgId: id, invitee: BOB.address, role: "MEMBER" }, ALICE);
    const waits: (number | null)[] = [];
    for (const delay of [0, MINUTE, 5 * MINUTE, 30 * MINUTE, 120 * MINUTE, 720 * MINUTE]) {
      t.tick(delay);
      await sweep(t);
      const [d] = await t.store.deliveries(webhook.id, 1);
      waits.push(d.nextAttemptAt ? d.nextAttemptAt.getTime() - t.clock.now.getTime() : null);
    }
    expect(waits).toEqual([MINUTE, 5 * MINUTE, 30 * MINUTE, 120 * MINUTE, 720 * MINUTE, null]);
    expect((await t.store.deliveries(webhook.id, 1))[0]).toMatchObject({ status: "FAILED", attempts: 6, responseStatus: 500 });
    expect((await t.store.webhook(webhook.id))?.consecutiveFailures).toBe(6);
    await t.store.updateWebhook(webhook.id, { consecutiveFailures: 49 }, t.clock.now);
    await t.mutate("testOrgWebhook", { orgId: id, webhookId: webhook.id }, ALICE);
    expect(await t.store.webhook(webhook.id)).toMatchObject({ enabled: false, consecutiveFailures: 50 });
    expect((await t.store.auditPage(id, 1))[0]).toMatchObject({ actor: "system", action: "system.webhookDisabled" });
    expect((await t.mutate<Webhook>("updateOrgWebhook", { orgId: id, webhookId: webhook.id, enabled: true }, ALICE))).toMatchObject({ enabled: true, consecutiveFailures: 0 });
  });

  it("refuses a delivery whose host now resolves privately", async () => {
    const r = receiver();
    const t = harnessResolvers(h, { net: r.net, webhookKey: () => KEY });
    const { id } = await createOrg(t, ALICE, "acme");
    const { webhook } = await endpoint(t, id);
    r.state.ip = "127.0.0.1";
    const ping = await t.mutate<Delivery>("testOrgWebhook", { orgId: id, webhookId: webhook.id }, ALICE);
    expect(ping).toMatchObject({ eventType: "ping", status: "FAILED", attempts: 1, responseStatus: null });
    expect(ping.lastError).toMatch(/non-public/);
    expect(r.requests).toEqual([]);
  });

  it("validates the URL and events, caps endpoints at 10, is for admins and needs the encryption key", async () => {
    const r = receiver();
    const t = harnessResolvers(h, { net: r.net, webhookKey: () => KEY });
    const { id } = await createOrg(t, ALICE, "acme");
    await join(t, id, BOB, "PUBLISHER");
    const create = (url: string, events: string[], who = ALICE) => t.mutate("createOrgWebhook", { orgId: id, url, events }, who);
    expect(await failure(create("http://hooks.example/", ["member.invited"]))).toMatchObject({ field: "url" });
    expect(await failure(create("https://user:pw@hooks.example/", ["member.invited"]))).toMatchObject({ field: "url" });
    expect(await failure(create("https://hooks.example/", []))).toMatchObject({ field: "events" });
    expect(await failure(create("https://hooks.example/", ["member.exploded"]))).toMatchObject({ field: "events" });
    expect((await failure(create("https://hooks.example/", ["member.invited"], BOB))).code).toBe("FORBIDDEN");
    r.state.ip = "10.1.1.1";
    expect(await failure(create("https://hooks.example/", ["member.invited"]))).toMatchObject({ field: "url" });
    r.state.ip = "93.184.216.34";
    for (let i = 0; i < 10; i++) await create(`https://hooks.example/${i}`, ["org.updated"]);
    expect((await failure(create("https://hooks.example/11", ["org.updated"]))).code).toBe("LIMIT_REACHED");
    const keyless = harnessResolvers(h, { net: r.net, webhookKey: () => null });
    expect((await failure(keyless.mutate("createOrgWebhook", { orgId: id, url: "https://h.example/", events: ["org.updated"] }, ALICE))).code).toBe("SERVICE_UNAVAILABLE");
  });

  it("pings once, keeps the newest 100 deliveries, updates and deletes endpoints", async () => {
    const r = receiver();
    const t = harnessResolvers(h, { net: r.net, webhookKey: () => KEY });
    const { id } = await createOrg(t, ALICE, "acme");
    const { webhook } = await endpoint(t, id);
    await t.store.insertDeliveries(
      Array.from({ length: 105 }, (_, i) => ({
        id: `old-${String(i).padStart(3, "0")}`, webhookId: webhook.id, orgId: id, eventId: `e${i}`, eventType: "member.invited", body: "{}",
        status: "DELIVERED" as const, attempts: 1, responseStatus: 200, lastError: null, createdAt: new Date(T0.getTime() - (200 - i) * MINUTE), nextAttemptAt: null, deliveredAt: T0,
      })),
    );
    expect(await t.mutate<Delivery>("testOrgWebhook", { orgId: id, webhookId: webhook.id }, ALICE)).toMatchObject({ eventType: "ping", status: "DELIVERED" });
    const kept = await t.store.deliveries(webhook.id, 500);
    expect(kept).toHaveLength(100);
    expect(kept[0].eventType).toBe("ping");
    expect((await t.mutate<Webhook>("updateOrgWebhook", { orgId: id, webhookId: webhook.id, events: ["org.updated", "org.updated"] }, ALICE)).events).toEqual(["org.updated"]);
    expect((await t.query<Webhook[]>("orgWebhooks", { orgId: id }, ALICE)).map((w) => w.events)).toEqual([["org.updated"]]);
    expect(await t.mutate("deleteOrgWebhook", { orgId: id, webhookId: webhook.id }, ALICE)).toBe(true);
    expect(await t.store.deliveries(webhook.id, 10)).toEqual([]);
    expect((await failure(t.query("orgWebhookDeliveries", { orgId: id, webhookId: webhook.id }, ALICE))).code).toBe("NOT_FOUND");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run subgraphs/renown-orgs 2>&1 | grep -E "Tests |FAIL" | head -6`
Expected: `insertWebhook is not a function`; `createOrgWebhook` is not a resolver.

- [ ] **Step 3: Store**

`subgraphs/renown-orgs/store/types.ts`:

```ts
export type DeliveryStatus = "PENDING" | "DELIVERED" | "FAILED";

export interface OrgWebhooksTable {
  id: string;
  org_id: string;
  url: string;
  events: JsonColumn;
  /** AES-256-GCM sealed secret (renown-workload's seal, the webhook id as additional data). */
  secret_sealed: string;
  enabled: boolean;
  consecutive_failures: Defaulted<number>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface OrgWebhookDeliveriesTable {
  id: string;
  webhook_id: string;
  org_id: string;
  event_id: string;
  event_type: string;
  /** The exact JSON body that is signed and sent. */
  body: string;
  status: DeliveryStatus;
  attempts: Defaulted<number>;
  response_status: number | null;
  last_error: string | null;
  created_at: Timestamp;
  next_attempt_at: Timestamp | null;
  delivered_at: Timestamp | null;
}

export interface WebhookRecord {
  id: string;
  orgId: string;
  url: string;
  events: string[];
  secretSealed: string;
  enabled: boolean;
  consecutiveFailures: number;
  createdAt: Date;
  updatedAt: Date;
}

export type WebhookPatch = Partial<Pick<WebhookRecord, "url" | "events" | "secretSealed" | "enabled" | "consecutiveFailures">>;

export interface DeliveryRecord {
  id: string;
  webhookId: string;
  orgId: string;
  eventId: string;
  eventType: string;
  body: string;
  status: DeliveryStatus;
  attempts: number;
  responseStatus: number | null;
  lastError: string | null;
  createdAt: Date;
  nextAttemptAt: Date | null;
  deliveredAt: Date | null;
}

export type DeliveryPatch = Partial<
  Pick<DeliveryRecord, "status" | "attempts" | "responseStatus" | "lastError" | "nextAttemptAt" | "deliveredAt">
>;
```

`org_webhooks: OrgWebhooksTable; org_webhook_deliveries: OrgWebhookDeliveriesTable;` in `OrgsDB`; `OrgStore` gains:

```ts
  insertWebhook(webhook: WebhookRecord): Promise<void>;
  webhook(id: string): Promise<WebhookRecord | undefined>;
  /** createdAt order. */
  webhooks(orgId: string): Promise<WebhookRecord[]>;
  updateWebhook(id: string, patch: WebhookPatch, now: Date): Promise<WebhookRecord | undefined>;
  /** Deletes the endpoint and its deliveries. */
  deleteWebhook(id: string): Promise<boolean>;
  insertDeliveries(rows: readonly DeliveryRecord[]): Promise<void>;
  /** Newest first. */
  deliveries(webhookId: string, limit: number): Promise<DeliveryRecord[]>;
  /** PENDING deliveries due at `now`, oldest due first. */
  dueDeliveries(now: Date, limit: number): Promise<DeliveryRecord[]>;
  updateDelivery(id: string, patch: DeliveryPatch): Promise<DeliveryRecord | undefined>;
  /** Keeps the newest `keep` deliveries of an endpoint. */
  pruneDeliveries(webhookId: string, keep: number): Promise<void>;
```

Migration (append):

```ts
  // A3: webhooks.
  await db.schema
    .createTable("org_webhooks")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("org_id", "text", (col) => col.notNull())
    .addColumn("url", "text", (col) => col.notNull())
    .addColumn("events", "jsonb", (col) => col.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn("secret_sealed", "text", (col) => col.notNull())
    .addColumn("enabled", "boolean", (col) => col.notNull().defaultTo(true))
    .addColumn("consecutive_failures", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("created_at", "timestamptz", (col) => col.notNull())
    .addColumn("updated_at", "timestamptz", (col) => col.notNull())
    .execute();
  await db.schema.createIndex("org_webhooks_org").ifNotExists().on("org_webhooks").column("org_id").execute();
  await db.schema
    .createTable("org_webhook_deliveries")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("webhook_id", "text", (col) => col.notNull())
    .addColumn("org_id", "text", (col) => col.notNull())
    .addColumn("event_id", "text", (col) => col.notNull())
    .addColumn("event_type", "text", (col) => col.notNull())
    .addColumn("body", "text", (col) => col.notNull())
    .addColumn("status", "text", (col) => col.notNull())
    .addColumn("attempts", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("response_status", "integer")
    .addColumn("last_error", "text")
    .addColumn("created_at", "timestamptz", (col) => col.notNull())
    .addColumn("next_attempt_at", "timestamptz")
    .addColumn("delivered_at", "timestamptz")
    .execute();
  await db.schema.createIndex("org_webhook_deliveries_hook").ifNotExists().on("org_webhook_deliveries").columns(["webhook_id", "created_at", "id"]).execute();
  await db.schema.createIndex("org_webhook_deliveries_due").ifNotExists().on("org_webhook_deliveries").columns(["status", "next_attempt_at"]).execute();
```

`KyselyOrgStore` (mappers at top level; import the new types):

```ts
function toWebhook(row: Selectable<OrgWebhooksTable>): WebhookRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    url: row.url,
    events: stringList(row.events),
    secretSealed: row.secret_sealed,
    enabled: row.enabled,
    consecutiveFailures: row.consecutive_failures,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function toDelivery(row: Selectable<OrgWebhookDeliveriesTable>): DeliveryRecord {
  return {
    id: row.id,
    webhookId: row.webhook_id,
    orgId: row.org_id,
    eventId: row.event_id,
    eventType: row.event_type,
    body: row.body,
    status: row.status,
    attempts: row.attempts,
    responseStatus: row.response_status,
    lastError: row.last_error,
    createdAt: toDate(row.created_at),
    nextAttemptAt: toDateOrNull(row.next_attempt_at),
    deliveredAt: toDateOrNull(row.delivered_at),
  };
}
```

```ts
  async insertWebhook(w: WebhookRecord): Promise<void> {
    await this.db
      .insertInto("org_webhooks")
      .values({
        id: w.id,
        org_id: w.orgId,
        url: w.url,
        events: JSON.stringify(w.events),
        secret_sealed: w.secretSealed,
        enabled: w.enabled,
        consecutive_failures: w.consecutiveFailures,
        created_at: w.createdAt,
        updated_at: w.updatedAt,
      })
      .execute();
  }

  async webhook(id: string): Promise<WebhookRecord | undefined> {
    const row = await this.db.selectFrom("org_webhooks").selectAll().where("id", "=", id).executeTakeFirst();
    return row && toWebhook(row);
  }

  async webhooks(orgId: string): Promise<WebhookRecord[]> {
    const rows = await this.db.selectFrom("org_webhooks").selectAll().where("org_id", "=", orgId).orderBy("created_at").orderBy("id").execute();
    return rows.map(toWebhook);
  }

  async updateWebhook(id: string, patch: WebhookPatch, now: Date): Promise<WebhookRecord | undefined> {
    const row = await this.db
      .updateTable("org_webhooks")
      .set({
        ...(patch.url !== undefined && { url: patch.url }),
        ...(patch.events !== undefined && { events: JSON.stringify(patch.events) }),
        ...(patch.secretSealed !== undefined && { secret_sealed: patch.secretSealed }),
        ...(patch.enabled !== undefined && { enabled: patch.enabled }),
        ...(patch.consecutiveFailures !== undefined && { consecutive_failures: patch.consecutiveFailures }),
        updated_at: now,
      })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
    return row && toWebhook(row);
  }

  async deleteWebhook(id: string): Promise<boolean> {
    await this.db.deleteFrom("org_webhook_deliveries").where("webhook_id", "=", id).execute();
    const result = await this.db.deleteFrom("org_webhooks").where("id", "=", id).executeTakeFirst();
    return Number(result.numDeletedRows) > 0;
  }

  async insertDeliveries(rows: readonly DeliveryRecord[]): Promise<void> {
    if (rows.length === 0) return;
    await this.db
      .insertInto("org_webhook_deliveries")
      .values(
        rows.map((d) => ({
          id: d.id,
          webhook_id: d.webhookId,
          org_id: d.orgId,
          event_id: d.eventId,
          event_type: d.eventType,
          body: d.body,
          status: d.status,
          attempts: d.attempts,
          response_status: d.responseStatus,
          last_error: d.lastError,
          created_at: d.createdAt,
          next_attempt_at: d.nextAttemptAt,
          delivered_at: d.deliveredAt,
        })),
      )
      .execute();
  }

  async deliveries(webhookId: string, limit: number): Promise<DeliveryRecord[]> {
    const rows = await this.db
      .selectFrom("org_webhook_deliveries")
      .selectAll()
      .where("webhook_id", "=", webhookId)
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .limit(limit)
      .execute();
    return rows.map(toDelivery);
  }

  async dueDeliveries(now: Date, limit: number): Promise<DeliveryRecord[]> {
    const rows = await this.db
      .selectFrom("org_webhook_deliveries")
      .selectAll()
      .where("status", "=", "PENDING")
      .where("next_attempt_at", "<=", now)
      .orderBy("next_attempt_at")
      .orderBy("id")
      .limit(limit)
      .execute();
    return rows.map(toDelivery);
  }

  async updateDelivery(id: string, patch: DeliveryPatch): Promise<DeliveryRecord | undefined> {
    const row = await this.db
      .updateTable("org_webhook_deliveries")
      .set({
        ...(patch.status !== undefined && { status: patch.status }),
        ...(patch.attempts !== undefined && { attempts: patch.attempts }),
        ...(patch.responseStatus !== undefined && { response_status: patch.responseStatus }),
        ...(patch.lastError !== undefined && { last_error: patch.lastError }),
        ...(patch.nextAttemptAt !== undefined && { next_attempt_at: patch.nextAttemptAt }),
        ...(patch.deliveredAt !== undefined && { delivered_at: patch.deliveredAt }),
      })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
    return row && toDelivery(row);
  }

  async pruneDeliveries(webhookId: string, keep: number): Promise<void> {
    const keepIds = this.db
      .selectFrom("org_webhook_deliveries")
      .select("id")
      .where("webhook_id", "=", webhookId)
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .limit(keep);
    await this.db.deleteFrom("org_webhook_deliveries").where("webhook_id", "=", webhookId).where("id", "not in", keepIds).execute();
  }
```

- [ ] **Step 4: Runtime key, delivery engine**

In `subgraphs/renown-orgs/runtime.ts`: import `loadConfig as loadWorkloadConfig` from `../renown-workload/core/config.js`; add `webhookKey?: () => Uint8Array | null;` to `OrgsResolverDeps` (doc: "The AES-256-GCM key sealing webhook secrets; RENOWN_WORKLOAD_KEY_ENCRYPTION_KEY by default"), `webhookKey(): Uint8Array | null;` to `OrgRuntime`, and in `createRuntime`:

```ts
  let workloadKey: Uint8Array | null | undefined;
```

with the returned member

```ts
    webhookKey: () => (deps.webhookKey ? deps.webhookKey() : (workloadKey ??= loadWorkloadConfig(process.env).config.encryptionKey)),
```

Create `subgraphs/renown-orgs/core/webhook-delivery.ts`:

```ts
import { createHmac } from "node:crypto";
import { open } from "../../renown-workload/core/crypto.js";
import type { OrgRuntime } from "../runtime.js";
import type { DeliveryRecord } from "../store/types.js";
import { guardedRequest } from "./net.js";

/** Waits before the 2nd … 6th attempt. */
export const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000] as const;
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;
export const AUTO_DISABLE_AFTER = 50;
export const KEEP_DELIVERIES = 100;
export const MAX_WEBHOOKS = 10;

/** The exact JSON a delivery sends (and signs). */
export function eventBody(event: { id: string; type: string; orgId: string; createdAt: Date; data: Record<string, unknown> }): string {
  return JSON.stringify({ id: event.id, type: event.type, orgId: event.orgId, createdAt: event.createdAt.toISOString(), data: event.data });
}

/** Renown-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>. */
export function signatureHeader(secret: string, body: string, at: Date): string {
  const t = Math.floor(at.getTime() / 1000);
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

/**
 * One delivery attempt: signs the stored body with the endpoint's secret and
 * POSTs it through the SSRF guard. A 2xx delivers; anything else is a failed
 * attempt, retried on the backoff schedule when `retry` (else FAILED at
 * once). Updates the endpoint's consecutive failures, disables it at 50, and
 * keeps the newest 100 deliveries. Never throws.
 */
export async function attemptDelivery(rt: OrgRuntime, delivery: DeliveryRecord, options: { retry: boolean }): Promise<DeliveryRecord> {
  const store = rt.store();
  const now = rt.now();
  const webhook = await store.webhook(delivery.webhookId);
  if (!webhook || !webhook.enabled) {
    return (await store.updateDelivery(delivery.id, { status: "FAILED", lastError: "The endpoint is disabled", nextAttemptAt: null })) ?? delivery;
  }
  let status: number | null = null;
  let error: string | null = null;
  const key = rt.webhookKey();
  if (!key) {
    error = "Webhook secrets cannot be opened (no encryption key)";
  } else {
    try {
      const secret = await open(key, webhook.secretSealed, webhook.id);
      const response = await guardedRequest(rt.net(), webhook.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "Renown-Webhooks/1",
          "renown-signature": signatureHeader(secret, delivery.body, now),
        },
        body: delivery.body,
      });
      status = response.status;
      if (status < 200 || status >= 300) error = `HTTP ${status}`;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }
  const attempts = delivery.attempts + 1;
  let updated: DeliveryRecord | undefined;
  if (error === null) {
    updated = await store.updateDelivery(delivery.id, { status: "DELIVERED", attempts, responseStatus: status, lastError: null, nextAttemptAt: null, deliveredAt: now });
    if (webhook.consecutiveFailures !== 0) await store.updateWebhook(webhook.id, { consecutiveFailures: 0 }, now);
  } else {
    const done = !options.retry || attempts >= MAX_ATTEMPTS;
    updated = await store.updateDelivery(delivery.id, {
      status: done ? "FAILED" : "PENDING",
      attempts,
      responseStatus: status,
      lastError: error,
      nextAttemptAt: done ? null : new Date(now.getTime() + RETRY_DELAYS_MS[attempts - 1]),
    });
    const failures = webhook.consecutiveFailures + 1;
    const disable = failures >= AUTO_DISABLE_AFTER;
    await store.updateWebhook(webhook.id, { consecutiveFailures: failures, ...(disable && { enabled: false }) }, now);
    if (disable) {
      await rt.record({
        orgId: webhook.orgId,
        actor: "system",
        action: "system.webhookDisabled",
        at: now,
        details: { webhookId: webhook.id, consecutiveFailures: failures },
      });
    }
  }
  await store.pruneDeliveries(webhook.id, KEEP_DELIVERIES);
  return updated ?? delivery;
}
```

- [ ] **Step 5: SDL, area and sink, delivery job**

Add to `subgraphs/renown-orgs/schema-integrations.ts` and to `INTEGRATIONS_SDL`:

```ts
export const WEBHOOKS_SDL = `
  enum OrgWebhookDeliveryStatus {
    PENDING
    DELIVERED
    FAILED
  }

  type OrgWebhook {
    id: String!
    orgId: String!
    url: String!
    events: [String!]!
    enabled: Boolean!
    consecutiveFailures: Int!
    createdAt: String!
  }

  type OrgWebhookCreated {
    webhook: OrgWebhook!
    "Shown once"
    secret: String!
  }

  type OrgWebhookDelivery {
    id: String!
    webhookId: String!
    eventId: String!
    eventType: String!
    status: OrgWebhookDeliveryStatus!
    attempts: Int!
    responseStatus: Int
    lastError: String
    createdAt: String!
    nextAttemptAt: String
    deliveredAt: String
  }

  extend type Query {
    "Admins."
    orgWebhooks(orgId: String!, auth: OrgAuthInput): [OrgWebhook!]!
    "Admins: newest first; limit 1-100 (default 20)."
    orgWebhookDeliveries(orgId: String!, webhookId: String!, limit: Int, auth: OrgAuthInput): [OrgWebhookDelivery!]!
  }

  extend type Mutation {
    "Admins; at most 10 endpoints; an https URL that resolves to public addresses; events from the documented list."
    createOrgWebhook(orgId: String!, url: String!, events: [String!]!, auth: OrgAuthInput): OrgWebhookCreated!
    "enabled: true also resets consecutiveFailures."
    updateOrgWebhook(orgId: String!, webhookId: String!, url: String, events: [String!], enabled: Boolean, auth: OrgAuthInput): OrgWebhook!
    deleteOrgWebhook(orgId: String!, webhookId: String!, auth: OrgAuthInput): Boolean!
    "Sends a ping event at once (one attempt)."
    testOrgWebhook(orgId: String!, webhookId: String!, auth: OrgAuthInput): OrgWebhookDelivery!
  }
`;
```

Create `subgraphs/renown-orgs/areas/webhooks.ts`:

```ts
import { isIP } from "node:net";
import { seal } from "../../renown-workload/core/crypto.js";
import { ORG_WEBHOOK_EVENTS, type ActivitySink } from "../core/activity.js";
import type { OrgArgs, OrgContext } from "../core/auth.js";
import { requireOrg, requireRole } from "../core/authz.js";
import { badInput, limitReached, notFound, unavailable } from "../core/errors.js";
import { isPublicAddress } from "../core/net.js";
import { attemptDelivery, eventBody, MAX_WEBHOOKS } from "../core/webhook-delivery.js";
import { iso, isoOrNull } from "../output.js";
import type { Area, OrgRuntime } from "../runtime.js";
import type { DeliveryRecord, WebhookRecord } from "../store/types.js";

const MAX_URL_LENGTH = 2048;
const KNOWN_EVENTS: ReadonlySet<string> = new Set(ORG_WEBHOOK_EVENTS);

function webhookOutput(w: WebhookRecord) {
  return { id: w.id, orgId: w.orgId, url: w.url, events: [...w.events], enabled: w.enabled, consecutiveFailures: w.consecutiveFailures, createdAt: iso(w.createdAt) };
}

function deliveryOutput(d: DeliveryRecord) {
  return {
    id: d.id,
    webhookId: d.webhookId,
    eventId: d.eventId,
    eventType: d.eventType,
    status: d.status,
    attempts: d.attempts,
    responseStatus: d.responseStatus,
    lastError: d.lastError,
    createdAt: iso(d.createdAt),
    nextAttemptAt: isoOrNull(d.nextAttemptAt),
    deliveredAt: isoOrNull(d.deliveredAt),
  };
}

/** An https URL without credentials whose host resolves only to public addresses; BAD_USER_INPUT (field url) otherwise. */
async function webhookUrl(rt: OrgRuntime, raw: string): Promise<string> {
  const value = raw.trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw badInput("url", "url must be an https URL");
  }
  if (url.protocol !== "https:" || url.username || url.password || value.length > MAX_URL_LENGTH) {
    throw badInput("url", "url must be an https URL of at most 2048 characters, without credentials");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : (await rt.net().lookup(host)).map((entry) => entry.address);
  } catch {
    throw badInput("url", `${host} does not resolve`);
  }
  if (addresses.length === 0 || !addresses.every(isPublicAddress)) throw badInput("url", `${host} must resolve to public addresses only`);
  return url.toString();
}

function eventsArg(values: readonly string[]): string[] {
  const events = [...new Set(values.map((value) => value.trim()))];
  if (events.length === 0 || !events.every((event) => KNOWN_EVENTS.has(event))) {
    throw badInput("events", `events must be a non-empty list of: ${[...KNOWN_EVENTS].join(", ")}`);
  }
  return events;
}

function requireKey(rt: OrgRuntime): Uint8Array {
  const key = rt.webhookKey();
  if (!key) throw unavailable("Webhooks are not available (no encryption key)");
  return key;
}

/** Queues a delivery for every enabled endpoint of the organisation subscribed to the activity's event. */
export function webhookSink(rt: OrgRuntime): ActivitySink {
  return async (activity) => {
    const event = activity.event;
    if (!event) return;
    const store = rt.store();
    const hooks = (await store.webhooks(activity.orgId)).filter((w) => w.enabled && w.events.includes(event.type));
    const body = eventBody({ id: activity.id, type: event.type, orgId: activity.orgId, createdAt: activity.at, data: event.data });
    await store.insertDeliveries(
      hooks.map((w) => ({
        id: rt.newId(),
        webhookId: w.id,
        orgId: activity.orgId,
        eventId: activity.id,
        eventType: event.type,
        body,
        status: "PENDING",
        attempts: 0,
        responseStatus: null,
        lastError: null,
        createdAt: activity.at,
        nextAttemptAt: activity.at,
        deliveredAt: null,
      })),
    );
  };
}

/** The admin's endpoint of `orgId`, or NOT_FOUND / FORBIDDEN. */
async function adminWebhook(rt: OrgRuntime, orgId: string, caller: string, webhookId: string, writable = true): Promise<WebhookRecord> {
  const store = rt.store();
  await requireOrg(store, orgId, { writable });
  await requireRole(store, orgId, caller, "ADMIN");
  const webhook = await store.webhook(webhookId);
  if (!webhook || webhook.orgId !== orgId) throw notFound("Webhook");
  return webhook;
}

export const webhookResolvers: Area = (rt) => {
  rt.sinks.push(webhookSink(rt));
  return {
    Query: {
      orgWebhooks: async (_: unknown, args: OrgArgs & { orgId: string }, ctx: OrgContext) => {
        const caller = await rt.caller(ctx, "orgWebhooks", args);
        const store = rt.store();
        await requireOrg(store, args.orgId, { writable: false });
        await requireRole(store, args.orgId, caller, "ADMIN");
        return (await store.webhooks(args.orgId)).map(webhookOutput);
      },
      orgWebhookDeliveries: async (_: unknown, args: OrgArgs & { orgId: string; webhookId: string; limit?: number | null }, ctx: OrgContext) => {
        const caller = await rt.caller(ctx, "orgWebhookDeliveries", args);
        const limit = args.limit ?? 20;
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw badInput("limit", "limit must be an integer from 1 to 100");
        const webhook = await adminWebhook(rt, args.orgId, caller, args.webhookId, false);
        return (await rt.store().deliveries(webhook.id, limit)).map(deliveryOutput);
      },
    },
    Mutation: {
      createOrgWebhook: async (_: unknown, args: OrgArgs & { orgId: string; url: string; events: string[] }, ctx: OrgContext) => {
        const caller = await rt.writer(ctx, "createOrgWebhook", args);
        const events = eventsArg(args.events);
        const url = await webhookUrl(rt, args.url);
        return rt.lock(`org:${args.orgId}`, async () => {
          const store = rt.store();
          const now = rt.now();
          await requireOrg(store, args.orgId);
          await requireRole(store, args.orgId, caller, "ADMIN");
          const key = requireKey(rt);
          if ((await store.webhooks(args.orgId)).length >= MAX_WEBHOOKS) throw limitReached(`At most ${MAX_WEBHOOKS} webhooks`);
          const id = rt.newId();
          const secret = rt.token(32);
          const webhook: WebhookRecord = {
            id,
            orgId: args.orgId,
            url,
            events,
            secretSealed: await seal(key, secret, id),
            enabled: true,
            consecutiveFailures: 0,
            createdAt: now,
            updatedAt: now,
          };
          await store.insertWebhook(webhook);
          await rt.record({ orgId: args.orgId, actor: caller, action: "createOrgWebhook", at: now, details: { webhookId: id, url, events } });
          return { webhook: webhookOutput(webhook), secret };
        });
      },
      updateOrgWebhook: async (
        _: unknown,
        args: OrgArgs & { orgId: string; webhookId: string; url?: string | null; events?: string[] | null; enabled?: boolean | null },
        ctx: OrgContext,
      ) => {
        const caller = await rt.writer(ctx, "updateOrgWebhook", args);
        const url = args.url != null ? await webhookUrl(rt, args.url) : undefined;
        const events = args.events != null ? eventsArg(args.events) : undefined;
        return rt.lock(`org:${args.orgId}`, async () => {
          const now = rt.now();
          const webhook = await adminWebhook(rt, args.orgId, caller, args.webhookId);
          const enabled = args.enabled ?? undefined;
          const updated = await rt.store().updateWebhook(
            webhook.id,
            {
              ...(url !== undefined && { url }),
              ...(events !== undefined && { events }),
              ...(enabled !== undefined && { enabled }),
              ...(enabled === true && { consecutiveFailures: 0 }),
            },
            now,
          );
          if (!updated) throw unavailable();
          await rt.record({ orgId: args.orgId, actor: caller, action: "updateOrgWebhook", at: now, details: { webhookId: webhook.id, url, events, enabled } });
          return webhookOutput(updated);
        });
      },
      deleteOrgWebhook: async (_: unknown, args: OrgArgs & { orgId: string; webhookId: string }, ctx: OrgContext) => {
        const caller = await rt.writer(ctx, "deleteOrgWebhook", args);
        return rt.lock(`org:${args.orgId}`, async () => {
          const webhook = await adminWebhook(rt, args.orgId, caller, args.webhookId);
          await rt.store().deleteWebhook(webhook.id);
          await rt.record({ orgId: args.orgId, actor: caller, action: "deleteOrgWebhook", at: rt.now(), details: { webhookId: webhook.id } });
          return true;
        });
      },
      testOrgWebhook: async (_: unknown, args: OrgArgs & { orgId: string; webhookId: string }, ctx: OrgContext) => {
        const caller = await rt.writer(ctx, "testOrgWebhook", args);
        const webhook = await adminWebhook(rt, args.orgId, caller, args.webhookId);
        requireKey(rt);
        const now = rt.now();
        const id = rt.newId();
        const ping: DeliveryRecord = {
          id,
          webhookId: webhook.id,
          orgId: webhook.orgId,
          eventId: id,
          eventType: "ping",
          body: eventBody({ id, type: "ping", orgId: webhook.orgId, createdAt: now, data: {} }),
          status: "PENDING",
          attempts: 0,
          responseStatus: null,
          lastError: null,
          createdAt: now,
          nextAttemptAt: null,
          deliveredAt: null,
        };
        await rt.store().insertDeliveries([ping]);
        return deliveryOutput(await attemptDelivery(rt, ping, { retry: false }));
      },
    },
  };
};
```

Append to `subgraphs/renown-orgs/jobs.ts` (and add it to `sweepJobs`):

```ts
/** Every minute: attempts every due delivery. */
export function webhookDeliveryJob(rt: OrgRuntime): SweepJob {
  return {
    name: "webhooks",
    everyMs: MINUTE_MS,
    async run() {
      for (const delivery of await rt.store().dueDeliveries(rt.now(), BATCH)) {
        await attemptDelivery(rt, delivery, { retry: true });
      }
    },
  };
}
```

(import `attemptDelivery` from `./core/webhook-delivery.js`.) Register `webhookResolvers` in `AREAS`.

- [ ] **Step 6: Run the suite, types, lint**

Run: `pnpm vitest run subgraphs/renown-orgs 2>&1 | grep -E "Test Files|Tests |FAIL"`
Expected: all pass.

Run: `pnpm tsc 2>&1 | tail -3 && pnpm lint 2>&1 | tail -3`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add subgraphs/renown-orgs
git commit -m "feat(orgs): signed webhooks with retries, auto-disable and SSRF-guarded delivery"
```

---

### Task 3: Org-owned OIDC clients

**Files:**
- Modify: `subgraphs/renown-orgs/store/{types,migrations,kysely}.ts` (`org_oidc_clients`), `runtime.ts` (`oidc`), `schema-integrations.ts` (`OIDC_SDL`), `resolvers.ts`, `tests/harness.ts` (renown-oidc namespace, OIDC client documents)
- Create: `subgraphs/renown-orgs/areas/oidc-clients.ts`
- Test: `subgraphs/renown-orgs/tests/oidc-clients.test.ts`

**Interfaces:**
- Consumes: A1 Task 9 (`registerClient`, `updateClient`, `rotateClientSecret`, `ClientRegistryError`, `ClientRegistryDeps` with `allowedOrgs`), `KyselyOidcStore`, `OidcKysely`, `OidcStore`, renown-oidc's `migrate`.
- Produces: store `insertOrgOidcClient({ clientId, orgId, createdBy, createdAt })`, `orgOidcClients(orgId)`, `orgOfOidcClient(clientId)`; runtime `OrgsResolverDeps.oidc?: () => { store: OidcStore; driveId: string | null }`, `OrgRuntime.oidc()`; GraphQL `OrgOidcClientStatus`, `OrgOidcClient`, `OrgOidcClientCredentials`, `orgOidcClients`, `registerOrgOidcClient`, `updateOrgOidcClient`, `rotateOrgOidcClientSecret`.

- [ ] **Step 1: Write the failing test**

In `subgraphs/renown-orgs/tests/harness.ts`: import `migrate as migrateOidc` from `../../renown-oidc/store/migrations.js`, `reducer as oidcReducer, renownOidcClientDocumentType, utils as oidcUtils` from `../../../document-models/renown-oidc-client/index.js`; `export const OIDC_NS = "renown-oidc";`; create and migrate it in `openHarness`; add it to `resetHarness`'s schema list; and add `[renownOidcClientDocumentType]: oidcReducer as never` to `fakeReactor`'s reducers and `[renownOidcClientDocumentType]: () => oidcUtils.createDocument() as never` to its creators.

Create `subgraphs/renown-orgs/tests/oidc-clients.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { KyselyOidcStore } from "../../renown-oidc/store/kysely.js";
import { ALICE, BOB, CAROL, createOrg, failure, harnessResolvers, join, OIDC_NS, openHarness, resetHarness, type Harness } from "./harness.js";

vi.mock("../../renown-auth/core/smart-wallet.js", () => ({
  verifyMessageOnChain: () => Promise.resolve(false),
  verifyTypedDataOnChain: () => Promise.resolve(false),
}));

const REDIRECT = "https://wiki.acme.example/oidc/callback";
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

describe("org-owned OIDC clients", () => {
  it("registers a confidential client restricted to the organisation's members", async () => {
    const t = harnessResolvers(h);
    const oidc = new KyselyOidcStore(h.root.withSchema(OIDC_NS));
    const { id } = await createOrg(t, ALICE, "acme");
    const created = await t.mutate<{ clientId: string; clientSecret: string }>("registerOrgOidcClient", { orgId: id, name: "Acme wiki", redirectUris: [REDIRECT] }, ALICE);
    expect(created.clientSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await oidc.getClient(created.clientId)).toMatchObject({
      name: "Acme wiki",
      redirectUris: [REDIRECT],
      allowedSubjects: [],
      allowAnySubject: false,
      status: "ACTIVE",
      allowedOrgs: [{ orgId: id, minRole: "MEMBER" }],
    });
    expect(JSON.stringify(await t.store.auditPage(id, 5))).not.toContain(created.clientSecret);
    expect(await t.query("orgOidcClients", { orgId: id }, ALICE)).toEqual([
      { clientId: created.clientId, orgId: id, name: "Acme wiki", redirectUris: [REDIRECT], status: "ACTIVE", createdAt: t.clock.now.toISOString() },
    ]);
  });

  it("lets admins update, disable and rotate their own organisation's clients only", async () => {
    const t = harnessResolvers(h);
    const oidc = new KyselyOidcStore(h.root.withSchema(OIDC_NS));
    const { id } = await createOrg(t, ALICE, "acme");
    const other = await createOrg(t, CAROL, "other");
    await join(t, id, BOB, "PUBLISHER");
    const { clientId, clientSecret } = await t.mutate<{ clientId: string; clientSecret: string }>("registerOrgOidcClient", { orgId: id, name: "Wiki", redirectUris: [REDIRECT] }, ALICE);
    const updated = await t.mutate<{ redirectUris: string[]; status: string; name: string }>(
      "updateOrgOidcClient",
      { orgId: id, clientId, name: "Acme Wiki", addRedirectUris: ["https://wiki2.acme.example/cb"], removeRedirectUris: [REDIRECT], status: "DISABLED" },
      ALICE,
    );
    expect(updated).toMatchObject({ name: "Acme Wiki", redirectUris: ["https://wiki2.acme.example/cb"], status: "DISABLED" });
    const rotated = await t.mutate<{ clientId: string; clientSecret: string }>("rotateOrgOidcClientSecret", { orgId: id, clientId }, ALICE);
    expect(rotated.clientSecret).not.toBe(clientSecret);
    expect((await oidc.getClient(clientId))?.allowedOrgs).toEqual([{ orgId: id, minRole: "MEMBER" }]);
    expect((await failure(t.mutate("updateOrgOidcClient", { orgId: other.id, clientId, name: "Mine" }, CAROL))).code).toBe("NOT_FOUND");
    expect((await failure(t.mutate("rotateOrgOidcClientSecret", { orgId: id, clientId }, BOB))).code).toBe("FORBIDDEN");
    expect(await failure(t.mutate("registerOrgOidcClient", { orgId: id, name: "Bad", redirectUris: ["http://evil.example/cb"] }, ALICE))).toMatchObject({ code: "BAD_USER_INPUT", field: "redirectUris" });
    expect(await failure(t.mutate("registerOrgOidcClient", { orgId: id, name: " ", redirectUris: [REDIRECT] }, ALICE))).toMatchObject({ code: "BAD_USER_INPUT", field: "name" });
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run subgraphs/renown-orgs/tests/oidc-clients.test.ts 2>&1 | grep -E "Tests |FAIL" | head -3`
Expected: fails (`registerOrgOidcClient` is not a resolver).

- [ ] **Step 3: Store and runtime**

`subgraphs/renown-orgs/store/types.ts`:

```ts
export interface OrgOidcClientsTable {
  client_id: string;
  org_id: string;
  created_by: string;
  created_at: Timestamp;
}

export interface OrgOidcClientLink {
  clientId: string;
  orgId: string;
  createdBy: string;
  createdAt: Date;
}
```

`org_oidc_clients: OrgOidcClientsTable;` in `OrgsDB`; `OrgStore` gains `insertOrgOidcClient(link: OrgOidcClientLink): Promise<void>;`, `orgOidcClients(orgId: string): Promise<OrgOidcClientLink[]>;` (createdAt order) and `orgOfOidcClient(clientId: string): Promise<string | undefined>;`.

Migration (append):

```ts
  await db.schema
    .createTable("org_oidc_clients")
    .ifNotExists()
    .addColumn("client_id", "text", (col) => col.primaryKey())
    .addColumn("org_id", "text", (col) => col.notNull())
    .addColumn("created_by", "text", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) => col.notNull())
    .execute();
  await db.schema.createIndex("org_oidc_clients_org").ifNotExists().on("org_oidc_clients").column("org_id").execute();
```

`KyselyOrgStore`:

```ts
  async insertOrgOidcClient(link: OrgOidcClientLink): Promise<void> {
    await this.db
      .insertInto("org_oidc_clients")
      .values({ client_id: link.clientId, org_id: link.orgId, created_by: link.createdBy, created_at: link.createdAt })
      .execute();
  }

  async orgOidcClients(orgId: string): Promise<OrgOidcClientLink[]> {
    const rows = await this.db.selectFrom("org_oidc_clients").selectAll().where("org_id", "=", orgId).orderBy("created_at").orderBy("client_id").execute();
    return rows.map((row) => ({ clientId: row.client_id, orgId: row.org_id, createdBy: row.created_by, createdAt: toDate(row.created_at) }));
  }

  async orgOfOidcClient(clientId: string): Promise<string | undefined> {
    const row = await this.db.selectFrom("org_oidc_clients").select("org_id").where("client_id", "=", clientId).executeTakeFirst();
    return row?.org_id;
  }
```

`subgraphs/renown-orgs/runtime.ts`: import `KyselyOidcStore` (`../renown-oidc/store/kysely.js`) and `type OidcKysely, type OidcStore` (`../renown-oidc/store/types.js`); add to `OrgsResolverDeps`

```ts
  /** The renown-oidc client store and mirror drive; the renown-oidc namespace of the host by default. */
  oidc?: () => { store: OidcStore; driveId: string | null };
```

to `OrgRuntime` `oidc(): { store: OidcStore; driveId: string | null };`, and to the returned object:

```ts
    oidc: () =>
      deps.oidc?.() ?? {
        store: new KyselyOidcStore(deps.relationalDb.queryNamespace("renown-oidc") as unknown as OidcKysely),
        driveId: process.env.RENOWN_OIDC_DRIVE_ID?.trim() || null,
      },
```

- [ ] **Step 4: SDL and area**

Add to `subgraphs/renown-orgs/schema-integrations.ts` and to `INTEGRATIONS_SDL`:

```ts
export const OIDC_SDL = `
  enum OrgOidcClientStatus {
    ACTIVE
    DISABLED
  }

  type OrgOidcClient {
    clientId: String!
    orgId: String!
    name: String!
    redirectUris: [String!]!
    status: OrgOidcClientStatus!
    createdAt: String!
  }

  type OrgOidcClientCredentials {
    clientId: String!
    "Shown once"
    clientSecret: String!
  }

  extend type Query {
    "Admins: the organisation's own OIDC clients."
    orgOidcClients(orgId: String!, auth: OrgAuthInput): [OrgOidcClient!]!
  }

  extend type Mutation {
    "Admins: a confidential client only the organisation's active members may sign in to."
    registerOrgOidcClient(orgId: String!, name: String!, redirectUris: [String!]!, auth: OrgAuthInput): OrgOidcClientCredentials!
    updateOrgOidcClient(
      orgId: String!
      clientId: String!
      name: String
      addRedirectUris: [String!]
      removeRedirectUris: [String!]
      status: OrgOidcClientStatus
      auth: OrgAuthInput
    ): OrgOidcClient!
    rotateOrgOidcClientSecret(orgId: String!, clientId: String!, auth: OrgAuthInput): OrgOidcClientCredentials!
  }
`;
```

Create `subgraphs/renown-orgs/areas/oidc-clients.ts`:

```ts
import {
  ClientRegistryError,
  registerClient,
  rotateClientSecret,
  updateClient,
  type ClientRegistryDeps,
} from "../../renown-oidc/register.js";
import type { OidcClient } from "../../renown-oidc/core/types.js";
import type { OrgArgs, OrgContext } from "../core/auth.js";
import { requireOrg, requireRole } from "../core/authz.js";
import { badInput, notFound } from "../core/errors.js";
import { iso } from "../output.js";
import type { Area, OrgRuntime } from "../runtime.js";

function registry(rt: OrgRuntime): ClientRegistryDeps {
  const oidc = rt.oidc();
  return {
    store: oidc.store,
    reactorClient: rt.deps.reactorClient,
    driveId: oidc.driveId,
    now: () => rt.now(),
    log: (message) => console.warn(message),
  };
}

/** Registry input and lookup errors as renown-orgs errors. */
async function viaRegistry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ClientRegistryError) {
      if (error.code === "NOT_FOUND") throw notFound("OIDC client");
      throw badInput(error.message.startsWith("Invalid redirect URI") ? "redirectUris" : "name", error.message);
    }
    throw error;
  }
}

function clientOutput(client: OidcClient, orgId: string, createdAt: Date) {
  return { clientId: client.id, orgId, name: client.name, redirectUris: [...client.redirectUris], status: client.status, createdAt: iso(createdAt) };
}

/** The admin's own client, or NOT_FOUND / FORBIDDEN. */
async function ownClient(rt: OrgRuntime, orgId: string, caller: string, clientId: string): Promise<void> {
  const store = rt.store();
  await requireOrg(store, orgId);
  await requireRole(store, orgId, caller, "ADMIN");
  if ((await store.orgOfOidcClient(clientId)) !== orgId) throw notFound("OIDC client");
}

export const oidcClientResolvers: Area = (rt) => ({
  Query: {
    orgOidcClients: async (_: unknown, args: OrgArgs & { orgId: string }, ctx: OrgContext) => {
      const caller = await rt.caller(ctx, "orgOidcClients", args);
      const store = rt.store();
      await requireOrg(store, args.orgId, { writable: false });
      await requireRole(store, args.orgId, caller, "ADMIN");
      const oidc = rt.oidc().store;
      const out = [];
      for (const link of await store.orgOidcClients(args.orgId)) {
        const client = await oidc.getClient(link.clientId);
        if (client) out.push(clientOutput(client, link.orgId, link.createdAt));
      }
      return out;
    },
  },
  Mutation: {
    registerOrgOidcClient: async (_: unknown, args: OrgArgs & { orgId: string; name: string; redirectUris: string[] }, ctx: OrgContext) => {
      const caller = await rt.writer(ctx, "registerOrgOidcClient", args);
      return rt.lock(`org:${args.orgId}`, async () => {
        const store = rt.store();
        const now = rt.now();
        await requireOrg(store, args.orgId);
        await requireRole(store, args.orgId, caller, "ADMIN");
        const credentials = await viaRegistry(() =>
          registerClient(registry(rt), {
            name: args.name,
            redirectUris: args.redirectUris,
            allowedSubjects: [],
            confidential: true,
            allowedOrgs: [{ orgId: args.orgId, minRole: "MEMBER" }],
          }),
        );
        await store.insertOrgOidcClient({ clientId: credentials.clientId, orgId: args.orgId, createdBy: caller, createdAt: now });
        await rt.record({ orgId: args.orgId, actor: caller, action: "registerOrgOidcClient", at: now, details: { clientId: credentials.clientId, name: args.name.trim(), redirectUris: args.redirectUris } });
        return { clientId: credentials.clientId, clientSecret: credentials.clientSecret ?? "" };
      });
    },
    updateOrgOidcClient: async (
      _: unknown,
      args: OrgArgs & {
        orgId: string;
        clientId: string;
        name?: string | null;
        addRedirectUris?: string[] | null;
        removeRedirectUris?: string[] | null;
        status?: "ACTIVE" | "DISABLED" | null;
      },
      ctx: OrgContext,
    ) => {
      const caller = await rt.writer(ctx, "updateOrgOidcClient", args);
      return rt.lock(`org:${args.orgId}`, async () => {
        await ownClient(rt, args.orgId, caller, args.clientId);
        const client = await viaRegistry(() =>
          updateClient(registry(rt), args.clientId, {
            name: args.name,
            addRedirectUris: args.addRedirectUris,
            removeRedirectUris: args.removeRedirectUris,
            status: args.status,
          }),
        );
        const link = (await rt.store().orgOidcClients(args.orgId)).find((entry) => entry.clientId === args.clientId);
        await rt.record({
          orgId: args.orgId,
          actor: caller,
          action: "updateOrgOidcClient",
          at: rt.now(),
          details: { clientId: args.clientId, name: args.name, addRedirectUris: args.addRedirectUris, removeRedirectUris: args.removeRedirectUris, status: args.status },
        });
        return clientOutput(client, args.orgId, link?.createdAt ?? rt.now());
      });
    },
    rotateOrgOidcClientSecret: async (_: unknown, args: OrgArgs & { orgId: string; clientId: string }, ctx: OrgContext) => {
      const caller = await rt.writer(ctx, "rotateOrgOidcClientSecret", args);
      return rt.lock(`org:${args.orgId}`, async () => {
        await ownClient(rt, args.orgId, caller, args.clientId);
        const credentials = await viaRegistry(() => rotateClientSecret(registry(rt), args.clientId, true));
        await rt.record({ orgId: args.orgId, actor: caller, action: "rotateOrgOidcClientSecret", at: rt.now(), details: { clientId: args.clientId } });
        return { clientId: credentials.clientId, clientSecret: credentials.clientSecret ?? "" };
      });
    },
  },
});
```

Register `oidcClientResolvers` in `AREAS`.

- [ ] **Step 5: Run the suite, types, lint**

Run: `pnpm vitest run subgraphs/renown-orgs subgraphs/renown-oidc 2>&1 | grep -E "Test Files|Tests |FAIL"`
Expected: all pass.

Run: `pnpm tsc 2>&1 | tail -3 && pnpm lint 2>&1 | tail -3`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add subgraphs/renown-orgs
git commit -m "feat(orgs): org-owned OIDC clients restricted to members"
```

---

### Task 4: Reports, platform moderation, handle release window, audit export

**Files:**
- Modify: `subgraphs/renown-orgs/store/{types,migrations,kysely}.ts` (`org_reports`), `core/handles.ts` (released-handle exception), `schema-integrations.ts` (`MODERATION_SDL`), `resolvers.ts`
- Create: `subgraphs/renown-orgs/areas/moderation.ts`
- Test: `subgraphs/renown-orgs/tests/moderation.test.ts`, `tests/store-contract.ts` (append)

**Interfaces:**
- Consumes: A1 (`orgHandleProblem`, `handleError`, `orgSummaries`, `organizationOutput`), A2 (`store.domains`, CHANGE_HANDLE), `OrgsConfig.platformAdmins`.
- Produces: store `type ReportStatus`, `interface ReportRecord`, `insertReport`, `report(id)`, `reports(status?)` (newest first), `countReportsSince(reporter, since)`, `resolveReport(id, resolution)` (only while OPEN); `orgHandleProblem` lets a RELEASED reservation be taken by an org with a VERIFIED domain whose first label equals the handle; GraphQL `OrgReportReason`, `OrgReportStatus`, `OrgReportResolution`, `OrgReport`, `orgReports`, `orgAuditExport`, `reportOrganization`, `resolveOrgReport`; `MAX_REPORTS_PER_DAY = 5`, `AUDIT_EXPORT_MAX = 10000`, `RELEASED_HANDLE_DAYS = 30`.

- [ ] **Step 1: Write the failing tests**

Append inside `describeOrgStoreContract` in `subgraphs/renown-orgs/tests/store-contract.ts`:

```ts
    it("keeps reports, counts a reporter's recent ones and resolves each once", async () => {
      const { store } = await open();
      const report = (id: string, createdAt: Date, reporter = ALICE) => ({
        id, orgId: "o1", reporter, reason: "SPAM", details: null, status: "OPEN" as const, resolution: null, resolvedBy: null, resolvedAt: null, note: null, createdAt,
      });
      await store.insertReport(report("r1", T0));
      await store.insertReport(report("r2", at(1)));
      await store.insertReport(report("r3", at(2), BOB));
      expect(await store.countReportsSince(ALICE, at(1))).toBe(1);
      expect((await store.reports("OPEN")).map((r) => r.id)).toEqual(["r3", "r2", "r1"]);
      expect(await store.resolveReport("r1", { resolution: "DISMISS", resolvedBy: BOB, resolvedAt: at(3), note: "ok" })).toMatchObject({ status: "RESOLVED", resolution: "DISMISS" });
      expect(await store.resolveReport("r1", { resolution: "TAKE_DOWN", resolvedBy: BOB, resolvedAt: at(4), note: null })).toBeUndefined();
      expect((await store.reports("RESOLVED")).map((r) => r.id)).toEqual(["r1"]);
      expect((await store.reports()).map((r) => r.id)).toEqual(["r3", "r2", "r1"]);
    });
```

Create `subgraphs/renown-orgs/tests/moderation.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RenownOrganizationState } from "../../../document-models/renown-organization/index.js";
import type { OrganizationOutput } from "../output.js";
import type { ProposalOutput } from "../areas/proposals.js";
import { ALICE, BOB, CAROL, DAVE, EVE, createOrg, failure, harnessResolvers, join, lower, openHarness, resetHarness, T0, type Harness, type TestResolvers } from "./harness.js";

vi.mock("../../renown-auth/core/smart-wallet.js", () => ({
  verifyMessageOnChain: () => Promise.resolve(false),
  verifyTypedDataOnChain: () => Promise.resolve(false),
}));

const HOUR = 3_600_000;
interface Report {
  id: string;
  orgId: string;
  org: { handle: string } | null;
  reporter: string;
  reason: string;
  status: string;
  resolution: string | null;
  resolvedBy: string | null;
}
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

const report = (t: TestResolvers, orgId: string, who = BOB, details: string | null = "Looks like a fake") =>
  t.mutate<boolean>("reportOrganization", { orgId, reason: "IMPERSONATION", details }, who);
const resolve = (t: TestResolvers, reportId: string, resolution: string) =>
  t.mutate<Report>("resolveOrgReport", { reportId, resolution, note: "checked" }, EVE);

describe("reports", () => {
  it("takes reports from anyone signed in, at most 5 a day each, visible to platform admins only", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    for (let i = 0; i < 5; i++) expect(await report(t, id)).toBe(true);
    expect((await failure(report(t, id))).code).toBe("RATE_LIMITED");
    expect(await failure(report(t, id, CAROL, "x".repeat(1001)))).toMatchObject({ field: "details" });
    expect((await failure(report(t, "nope", CAROL))).code).toBe("NOT_FOUND");
    expect((await failure(t.query("orgReports", {}, ALICE))).code).toBe("FORBIDDEN");
    const open = await t.query<Report[]>("orgReports", { status: "OPEN" }, EVE);
    expect(open).toHaveLength(5);
    expect(open[0]).toMatchObject({ orgId: id, org: { handle: "acme" }, reporter: lower(BOB), reason: "IMPERSONATION", status: "OPEN" });
    expect((await t.store.auditPage(id, 10)).some((e) => e.action === "reportOrganization")).toBe(false);
    t.tick(24 * HOUR + 1);
    expect(await report(t, id)).toBe(true);
  });

  it("takes an organisation down and restores it, auditing each resolution on the org", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme", { listed: true });
    await report(t, id);
    const [first] = await t.query<Report[]>("orgReports", { status: "OPEN" }, EVE);
    expect(await resolve(t, first.id, "TAKE_DOWN")).toMatchObject({ status: "RESOLVED", resolution: "TAKE_DOWN", resolvedBy: lower(EVE) });
    expect((await t.query<OrganizationOutput>("organization", { id }))).toMatchObject({ takenDown: true, bio: null });
    expect((await t.query<{ items: unknown[] }>("organizationSearch", {})).items).toEqual([]);
    expect(await t.query("orgMembership", { orgId: id, address: ALICE.address })).toBeNull();
    expect(t.reactor.state<RenownOrganizationState>(id).takenDown).toBe(true);
    expect(await failure(resolve(t, first.id, "DISMISS"))).toMatchObject({ field: "reportId" });
    await report(t, id, CAROL);
    const [second] = await t.query<Report[]>("orgReports", { status: "OPEN" }, EVE);
    await resolve(t, second.id, "RESTORE");
    expect((await t.query<OrganizationOutput>("organization", { id }))?.takenDown).toBe(false);
    expect((await t.store.auditPage(id, 5)).filter((e) => e.action === "resolveOrgReport").map((e) => [e.actor, e.details.resolution])).toEqual([
      [lower(EVE), "RESTORE"],
      [lower(EVE), "TAKE_DOWN"],
    ]);
  });

  it("releases a disputed handle: the org is renamed and only the org verified for <handle>.<tld> may take it", async () => {
    const t = harnessResolvers(h);
    const squatter = await createOrg(t, ALICE, "acme");
    const owner = await createOrg(t, BOB, "acme-corp");
    const other = await createOrg(t, CAROL, "someone");
    await report(t, squatter.id, DAVE);
    const [r] = await t.query<Report[]>("orgReports", {}, EVE);
    await resolve(t, r.id, "RELEASE_HANDLE");
    const renamed = await t.query<OrganizationOutput>("organization", { id: squatter.id });
    expect(renamed?.handle).toBe(`org-${squatter.id.slice(0, 8).toLowerCase()}`);
    expect((await t.store.reservedHandle("acme", t.clock.now))?.reason).toBe("RELEASED");
    expect((await failure(t.mutate("proposeOrgChange", { orgId: other.id, kind: "CHANGE_HANDLE", payload: { handle: "acme" } }, CAROL))).code).toBe("HANDLE_RESERVED");
    await t.store.db
      .insertInto("org_domains")
      .values({ id: "d1", org_id: owner.id, domain: "acme.example", token: "t", status: "VERIFIED", verified_at: T0, last_checked_at: T0, failures: 0, created_at: T0 })
      .execute();
    const p = await t.mutate<ProposalOutput>("proposeOrgChange", { orgId: owner.id, kind: "CHANGE_HANDLE", payload: { handle: "acme" } }, BOB);
    t.tick(HOUR);
    expect((await t.mutate<ProposalOutput>("executeOrgProposal", { orgId: owner.id, proposalId: p.id }, BOB)).status).toBe("EXECUTED");
    expect((await t.query<OrganizationOutput>("organization", { handle: "acme" }))?.id).toBe(owner.id);
  });
});

describe("orgAuditExport", () => {
  it("exports the newest entries as a JSON array for admins only", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    await join(t, id, BOB, "MEMBER");
    const exported = JSON.parse(await t.query<string>("orgAuditExport", { orgId: id }, ALICE)) as { action: string; actor: string; details: unknown }[];
    expect(exported.map((e) => e.action)).toEqual(["respondToOrgInvite", "inviteOrgMember", "createOrganization"]);
    expect(exported[2]).toMatchObject({ actor: lower(ALICE), details: { handle: "acme", name: "ACME" } });
    expect((await failure(t.query("orgAuditExport", { orgId: id }, BOB))).code).toBe("FORBIDDEN");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run subgraphs/renown-orgs 2>&1 | grep -E "Tests |FAIL" | head -6`
Expected: `insertReport is not a function`; `reportOrganization` is not a resolver.

- [ ] **Step 3: Store**

`subgraphs/renown-orgs/store/types.ts`:

```ts
export type ReportStatus = "OPEN" | "RESOLVED";

export interface OrgReportsTable {
  id: string;
  org_id: string;
  reporter: string;
  reason: string;
  details: string | null;
  status: ReportStatus;
  resolution: string | null;
  resolved_by: string | null;
  resolved_at: Timestamp | null;
  note: string | null;
  created_at: Timestamp;
}

export interface ReportRecord {
  id: string;
  orgId: string;
  reporter: string;
  reason: string;
  details: string | null;
  status: ReportStatus;
  resolution: string | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  note: string | null;
  createdAt: Date;
}
```

`org_reports: OrgReportsTable;` in `OrgsDB`; `OrgStore` gains:

```ts
  insertReport(report: ReportRecord): Promise<void>;
  report(id: string): Promise<ReportRecord | undefined>;
  /** Newest first; only `status` when given. */
  reports(status?: ReportStatus): Promise<ReportRecord[]>;
  countReportsSince(reporter: string, since: Date): Promise<number>;
  /** Resolves an OPEN report; undefined when it is not OPEN (or unknown). */
  resolveReport(id: string, resolution: { resolution: string; resolvedBy: string; resolvedAt: Date; note: string | null }): Promise<ReportRecord | undefined>;
```

Migration (append):

```ts
  await db.schema
    .createTable("org_reports")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("org_id", "text", (col) => col.notNull())
    .addColumn("reporter", "text", (col) => col.notNull())
    .addColumn("reason", "text", (col) => col.notNull())
    .addColumn("details", "text")
    .addColumn("status", "text", (col) => col.notNull())
    .addColumn("resolution", "text")
    .addColumn("resolved_by", "text")
    .addColumn("resolved_at", "timestamptz")
    .addColumn("note", "text")
    .addColumn("created_at", "timestamptz", (col) => col.notNull())
    .execute();
  await db.schema.createIndex("org_reports_status").ifNotExists().on("org_reports").columns(["status", "created_at"]).execute();
  await db.schema.createIndex("org_reports_reporter").ifNotExists().on("org_reports").columns(["reporter", "created_at"]).execute();
```

`KyselyOrgStore` (mapper at top level):

```ts
function toReport(row: Selectable<OrgReportsTable>): ReportRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    reporter: row.reporter,
    reason: row.reason,
    details: row.details,
    status: row.status,
    resolution: row.resolution,
    resolvedBy: row.resolved_by,
    resolvedAt: toDateOrNull(row.resolved_at),
    note: row.note,
    createdAt: toDate(row.created_at),
  };
}
```

```ts
  async insertReport(r: ReportRecord): Promise<void> {
    await this.db
      .insertInto("org_reports")
      .values({
        id: r.id,
        org_id: r.orgId,
        reporter: r.reporter.toLowerCase(),
        reason: r.reason,
        details: r.details,
        status: r.status,
        resolution: r.resolution,
        resolved_by: r.resolvedBy,
        resolved_at: r.resolvedAt,
        note: r.note,
        created_at: r.createdAt,
      })
      .execute();
  }

  async report(id: string): Promise<ReportRecord | undefined> {
    const row = await this.db.selectFrom("org_reports").selectAll().where("id", "=", id).executeTakeFirst();
    return row && toReport(row);
  }

  async reports(status?: ReportStatus): Promise<ReportRecord[]> {
    let query = this.db.selectFrom("org_reports").selectAll();
    if (status) query = query.where("status", "=", status);
    const rows = await query.orderBy("created_at", "desc").orderBy("id", "desc").execute();
    return rows.map(toReport);
  }

  async countReportsSince(reporter: string, since: Date): Promise<number> {
    const row = await this.db
      .selectFrom("org_reports")
      .select(sql<number>`count(*)::int`.as("n"))
      .where("reporter", "=", reporter.toLowerCase())
      .where("created_at", ">=", since)
      .executeTakeFirstOrThrow();
    return Number(row.n);
  }

  async resolveReport(
    id: string,
    resolution: { resolution: string; resolvedBy: string; resolvedAt: Date; note: string | null },
  ): Promise<ReportRecord | undefined> {
    const row = await this.db
      .updateTable("org_reports")
      .set({ status: "RESOLVED", resolution: resolution.resolution, resolved_by: resolution.resolvedBy, resolved_at: resolution.resolvedAt, note: resolution.note })
      .where("id", "=", id)
      .where("status", "=", "OPEN")
      .returningAll()
      .executeTakeFirst();
    return row && toReport(row);
  }
```

- [ ] **Step 4: The released-handle window**

In `subgraphs/renown-orgs/core/handles.ts`, replace

```ts
  const reserved = await deps.store.reservedHandle(handle, deps.now);
  if (reserved && (orgId === undefined || reserved.orgId !== orgId)) return "RESERVED";
```

with

```ts
  const reserved = await deps.store.reservedHandle(handle, deps.now);
  if (reserved && (orgId === undefined || reserved.orgId !== orgId)) {
    // A handle released after a dispute may go to the org that verified <handle>.<tld>.
    const claimable =
      reserved.reason === "RELEASED" &&
      orgId !== undefined &&
      (await deps.store.domains(orgId)).some((d) => d.status === "VERIFIED" && d.domain.split(".")[0] === handle);
    if (!claimable) return "RESERVED";
  }
```

- [ ] **Step 5: SDL and area**

Add to `subgraphs/renown-orgs/schema-integrations.ts` and to `INTEGRATIONS_SDL` (final: `[NOTIFICATIONS_SDL, WEBHOOKS_SDL, OIDC_SDL, MODERATION_SDL]`):

```ts
export const MODERATION_SDL = `
  enum OrgReportReason {
    IMPERSONATION
    HANDLE_DISPUTE
    SPAM
    ABUSE
    OTHER
  }

  enum OrgReportStatus {
    OPEN
    RESOLVED
  }

  enum OrgReportResolution {
    DISMISS
    TAKE_DOWN
    RELEASE_HANDLE
    RESTORE
  }

  type OrgReport {
    id: String!
    orgId: String!
    org: OrgSummary
    reporter: String!
    reason: OrgReportReason!
    details: String
    status: OrgReportStatus!
    resolution: OrgReportResolution
    resolvedBy: String
    resolvedAt: String
    note: String
    createdAt: String!
  }

  extend type Query {
    "Platform admins (RENOWN_PLATFORM_ADMINS) only; newest first."
    orgReports(status: OrgReportStatus, auth: OrgAuthInput): [OrgReport!]!
    "Admins: a JSON array of the newest 10 000 audit entries, newest first."
    orgAuditExport(orgId: String!, auth: OrgAuthInput): String!
  }

  extend type Mutation {
    "Anyone signed in; details at most 1000 characters; 5 reports per address per day."
    reportOrganization(orgId: String!, reason: OrgReportReason!, details: String, auth: OrgAuthInput): Boolean!
    "Platform admins only."
    resolveOrgReport(reportId: String!, resolution: OrgReportResolution!, note: String, auth: OrgAuthInput): OrgReport!
  }
`;
```

Create `subgraphs/renown-orgs/areas/moderation.ts`:

```ts
import { actions as orgActions } from "../../../document-models/renown-organization/index.js";
import type { OrgArgs, OrgContext } from "../core/auth.js";
import { requireOrg, requireRole } from "../core/authz.js";
import { badInput, forbidden, notFound, rateLimited, unavailable } from "../core/errors.js";
import { orgHandleProblem } from "../core/handles.js";
import { iso, isoOrNull, orgSummaries } from "../output.js";
import type { Area, OrgRuntime } from "../runtime.js";
import type { OrgRecord, ReportRecord } from "../store/types.js";

export const MAX_REPORTS_PER_DAY = 5;
export const MAX_REPORT_TEXT = 1000;
export const AUDIT_EXPORT_MAX = 10_000;
export const RELEASED_HANDLE_DAYS = 30;
const DAY_MS = 86_400_000;

type Resolution = "DISMISS" | "TAKE_DOWN" | "RELEASE_HANDLE" | "RESTORE";

function requirePlatformAdmin(rt: OrgRuntime, caller: string): void {
  if (!rt.config().platformAdmins.has(caller)) throw forbidden();
}

async function reportOutputs(rt: OrgRuntime, reports: readonly ReportRecord[]) {
  const orgs = await orgSummaries(rt, await rt.store().organizationsByIds([...new Set(reports.map((r) => r.orgId))]));
  return reports.map((r) => ({
    id: r.id,
    orgId: r.orgId,
    org: orgs.get(r.orgId) ?? null,
    reporter: r.reporter,
    reason: r.reason,
    details: r.details,
    status: r.status,
    resolution: r.resolution,
    resolvedBy: r.resolvedBy,
    resolvedAt: isoOrNull(r.resolvedAt),
    note: r.note,
    createdAt: iso(r.createdAt),
  }));
}

/** org-<first 8 of id>, or with -2, -3 … when taken. */
async function releasedName(rt: OrgRuntime, org: OrgRecord): Promise<string> {
  const base = `org-${org.id.slice(0, 8).toLowerCase().replace(/[^a-z0-9]/g, "0")}`;
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    if ((await orgHandleProblem({ store: rt.store(), relationalDb: rt.deps.relationalDb, now: rt.now() }, candidate, org.id)) === null) return candidate;
  }
}

/** Applies a resolution to the organisation (document and store). The caller holds the org lock. */
async function applyResolution(rt: OrgRuntime, org: OrgRecord, resolution: Resolution, now: Date): Promise<string[]> {
  const store = rt.store();
  if (resolution === "TAKE_DOWN" || resolution === "RESTORE") {
    const takenDown = resolution === "TAKE_DOWN";
    await rt.execute(org.id, [orgActions.setTakenDown({ takenDown })]);
    await store.updateOrganization(org.id, { takenDown }, now);
    return ["takenDown"];
  }
  if (resolution === "RELEASE_HANDLE") {
    const handle = await releasedName(rt, org);
    await rt.execute(org.id, [orgActions.setOrgHandle({ handle })]);
    await store.updateOrganization(org.id, { handle }, now);
    await store.reserveHandle({ handle: org.handle, until: new Date(now.getTime() + RELEASED_HANDLE_DAYS * DAY_MS), reason: "RELEASED", orgId: null });
    return ["handle"];
  }
  return [];
}

export const moderationResolvers: Area = (rt) => ({
  Query: {
    orgReports: async (_: unknown, args: OrgArgs & { status?: "OPEN" | "RESOLVED" | null }, ctx: OrgContext) => {
      const caller = await rt.caller(ctx, "orgReports", args);
      requirePlatformAdmin(rt, caller);
      return reportOutputs(rt, await rt.store().reports(args.status ?? undefined));
    },
    orgAuditExport: async (_: unknown, args: OrgArgs & { orgId: string }, ctx: OrgContext) => {
      const caller = await rt.caller(ctx, "orgAuditExport", args);
      const store = rt.store();
      await requireOrg(store, args.orgId, { writable: false });
      await requireRole(store, args.orgId, caller, "ADMIN");
      const entries = await store.auditPage(args.orgId, AUDIT_EXPORT_MAX);
      return JSON.stringify(entries.map((e) => ({ id: e.id, at: iso(e.at), actor: e.actor, action: e.action, details: e.details })));
    },
  },
  Mutation: {
    reportOrganization: async (_: unknown, args: OrgArgs & { orgId: string; reason: string; details?: string | null }, ctx: OrgContext) => {
      const caller = await rt.writer(ctx, "reportOrganization", args);
      const details = args.details?.trim() || null;
      if (details && details.length > MAX_REPORT_TEXT) throw badInput("details", `details must be at most ${MAX_REPORT_TEXT} characters`);
      const store = rt.store();
      const now = rt.now();
      if (!(await store.organization(args.orgId))) throw notFound("Organization");
      if ((await store.countReportsSince(caller, new Date(now.getTime() - DAY_MS))) >= MAX_REPORTS_PER_DAY) throw rateLimited();
      await store.insertReport({
        id: rt.newId(),
        orgId: args.orgId,
        reporter: caller,
        reason: args.reason,
        details,
        status: "OPEN",
        resolution: null,
        resolvedBy: null,
        resolvedAt: null,
        note: null,
        createdAt: now,
      });
      return true;
    },
    resolveOrgReport: async (_: unknown, args: OrgArgs & { reportId: string; resolution: Resolution; note?: string | null }, ctx: OrgContext) => {
      const caller = await rt.writer(ctx, "resolveOrgReport", args);
      requirePlatformAdmin(rt, caller);
      const note = args.note?.trim() || null;
      if (note && note.length > MAX_REPORT_TEXT) throw badInput("note", `note must be at most ${MAX_REPORT_TEXT} characters`);
      const found = await rt.store().report(args.reportId);
      if (!found) throw notFound("Report");
      return rt.lock(`org:${found.orgId}`, async () => {
        const store = rt.store();
        const now = rt.now();
        const report = await store.report(found.id);
        if (report?.status !== "OPEN") throw badInput("reportId", "The report is already resolved");
        const org = await store.organization(report.orgId);
        if (!org) throw notFound("Organization");
        const fields = await applyResolution(rt, org, args.resolution, now);
        const resolved = await store.resolveReport(report.id, { resolution: args.resolution, resolvedBy: caller, resolvedAt: now, note });
        if (!resolved) throw unavailable();
        await rt.record({
          orgId: org.id,
          actor: caller,
          action: "resolveOrgReport",
          at: now,
          details: { reportId: report.id, resolution: args.resolution, note },
          ...(fields.length > 0 && { event: { type: "org.updated" as const, data: { fields } } }),
        });
        const [output] = await reportOutputs(rt, [resolved]);
        return output;
      });
    },
  },
});
```

Register `moderationResolvers` in `AREAS`.

- [ ] **Step 6: Run the suite, types, lint**

Run: `pnpm vitest run subgraphs/renown-orgs 2>&1 | grep -E "Test Files|Tests |FAIL"`
Expected: all pass.

Run: `pnpm tsc 2>&1 | tail -3 && pnpm lint 2>&1 | tail -3`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add subgraphs/renown-orgs
git commit -m "feat(orgs): reports, platform moderation with handle release, audit export"
```

---

### Task 5: Support and security contacts on app profiles

**Files:**
- Modify: `document-models/renown-app-profile/renown-app-profile.json` (state, initial value, SET_PROFILE input and error)
- Regenerate: `document-models/renown-app-profile/v1/gen/**`, `v1/schema.graphql`
- Modify: `document-models/renown-app-profile/v1/src/utils.ts`, `v1/src/reducers/profile.ts`, `v1/tests/profile.test.ts` (append)
- Modify: `subgraphs/renown-stats/core/app-profile-patch.ts`, `resolvers.ts`, `schema.ts`, `tests/resolvers.test.ts` (one expectation)
- Test: `subgraphs/renown-stats/tests/contacts.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `RenownAppProfileState.supportContact?: Maybe<string>`, `securityContact?: Maybe<string>`; `setProfile({ ..., supportContact?, securityContact? })` (`""` clears); `MAX_CONTACT_LENGTH = 200`, `isContact(value)`; error `InvalidContactError`; renown-stats `RichProfileFields.supportContact/securityContact`, GraphQL `AppProfile.supportContact: String`, `AppProfile.securityContact: String`, `upsertAppProfile(..., supportContact: String, securityContact: String)`.

- [ ] **Step 1: Extend the model spec and generate**

```bash
python3 - <<'PY'
import json
p = "document-models/renown-app-profile/renown-app-profile.json"
d = json.load(open(p))
spec = d["specifications"][0]
g = spec["state"]["global"]
anchor = "  coverRef: AttachmentRef\n"
assert g["schema"].count(anchor) == 1 and "supportContact" not in g["schema"]
g["schema"] = g["schema"].replace(anchor, anchor
    + "  \"Support contact: an email address or an https URL, at most 200 characters\"\n  supportContact: String\n"
    + "  \"Security contact (vulnerability reports): an email address or an https URL, at most 200 characters\"\n  securityContact: String\n")
iv = json.loads(g["initialValue"]); iv["supportContact"] = None; iv["securityContact"] = None
g["initialValue"] = json.dumps(iv, indent=2)
op = next(o for m in spec["modules"] for o in m["operations"] if o["name"] == "SET_PROFILE")
assert op["schema"].endswith("}")
op["schema"] = op["schema"][:-1] + ("  \"An email address or an https URL, at most 200 characters; empty clears\"\n  supportContact: String\n"
    "  \"An email address or an https URL, at most 200 characters; empty clears\"\n  securityContact: String\n}")
op["errors"].append({"id": "invalid-contact-error", "name": "InvalidContactError", "code": "INVALID_CONTACT",
                     "description": "A contact is neither an email address nor an https URL, or longer than 200 characters", "template": ""})
open(p, "w").write(json.dumps(d, indent=2))
PY
pnpm generate document-model --document document-models/renown-app-profile/renown-app-profile.json 2>&1 | tail -3
git checkout -- powerhouse.manifest.json document-models/renown-app-profile/v1/src document-models/renown-app-profile/v1/tests 2>/dev/null || true
git status --short | head
```

Expected: only `renown-app-profile.json`, `v1/gen/**` and `v1/schema.graphql` changed (`pnpm tsc` now reports nothing new: the reducer already compiles, the input simply gained optional fields).

- [ ] **Step 2: Write the failing tests**

Append to `document-models/renown-app-profile/v1/tests/profile.test.ts`:

```ts
describe("contacts", () => {
  it("sets, validates and clears the support and security contacts", () => {
    let d = reducer(utils.createDocument(), setAppDid({ appDid: APP }));
    d = reducer(d, setProfile({ supportContact: " help@acme.example ", securityContact: "https://acme.example/security" }));
    expect(d.state.global).toMatchObject({ supportContact: "help@acme.example", securityContact: "https://acme.example/security" });
    d = reducer(d, setProfile({ supportContact: "http://acme.example" }));
    d = reducer(d, setProfile({ securityContact: "mailto:security@acme.example" }));
    d = reducer(d, setProfile({ securityContact: `https://acme.example/${"x".repeat(200)}` }));
    expect(d.operations.global.slice(-3).map((op) => op.error)).toEqual([
      "Invalid contact: http://acme.example",
      "Invalid contact: mailto:security@acme.example",
      `Invalid contact: https://acme.example/${"x".repeat(200)}`,
    ]);
    d = reducer(d, setProfile({ supportContact: "", securityContact: null }));
    expect(d.state.global).toMatchObject({ supportContact: null, securityContact: "https://acme.example/security" });
  });
});
```

In `subgraphs/renown-stats/tests/resolvers.test.ts` the `expected` object of "creates a profile and finds it by publisher …" gains `supportContact: null, securityContact: null,` after `coverRef: null,`.

Create `subgraphs/renown-stats/tests/contacts.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { failure, harnessResolvers, openHarness, registerApp, resetHarness, type Harness } from "./harness.js";

const APP = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";
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

describe("app profile contacts", () => {
  it("relays, returns and clears support and security contacts", async () => {
    await registerApp(h, APP);
    const t = harnessResolvers(h);
    await t.upsert({ appDid: APP, name: "Acme", supportContact: "help@acme.example", securityContact: "https://acme.example/.well-known/security.txt" });
    expect(await t.appProfile(APP)).toMatchObject({ supportContact: "help@acme.example", securityContact: "https://acme.example/.well-known/security.txt" });
    await t.upsert({ appDid: APP, supportContact: "" });
    expect(await t.appProfile(APP)).toMatchObject({ supportContact: null, securityContact: "https://acme.example/.well-known/security.txt" });
    expect(await failure(t.upsert({ appDid: APP, securityContact: "javascript:alert(1)" }))).toMatchObject({ code: "BAD_USER_INPUT", field: "securityContact" });
    expect(await failure(t.upsert({ appDid: APP, supportContact: `${"x".repeat(190)}@acme.example` }))).toMatchObject({ field: "supportContact" });
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm vitest run document-models/renown-app-profile subgraphs/renown-stats 2>&1 | grep -E "Tests |FAIL" | head -6`
Expected: the contacts tests fail (the reducer ignores the fields; renown-stats has no such arguments).

- [ ] **Step 4: Utils and reducer**

Append to `document-models/renown-app-profile/v1/src/utils.ts`:

```ts
export const MAX_CONTACT_LENGTH = 200;
const EMAIL_RE = /^[^\s@<>()"',;:]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

/** An email address (stored without mailto:) or an https URL, at most 200 characters. */
export function isContact(value: string): boolean {
  if (value.length === 0 || value.length > MAX_CONTACT_LENGTH) return false;
  return EMAIL_RE.test(value) || protocolOf(value) === "https:";
}
```

In `document-models/renown-app-profile/v1/src/reducers/profile.ts`: add `InvalidContactError` to the `../../gen/profile/error.js` import and `isContact` to the `../utils.js` import; in `setProfileOperation`, after `const coverRef = imageRefPatch(action.input.coverRef);` add

```ts
      const supportContact = patchValue(action.input.supportContact);
      const securityContact = patchValue(action.input.securityContact);
      for (const contact of [supportContact, securityContact]) {
        if (contact && !isContact(contact)) throw new InvalidContactError(`Invalid contact: ${contact}`);
      }
```

and after `if (coverRef !== undefined) state.coverRef = coverRef;`

```ts
      if (supportContact !== undefined) state.supportContact = supportContact;
      if (securityContact !== undefined) state.securityContact = securityContact;
```

- [ ] **Step 5: renown-stats**

`subgraphs/renown-stats/core/app-profile-patch.ts`: import `isContact` from the app-profile barrel; `RichProfileFields` and `RichProfilePatch` gain `supportContact?: string | null;`/`supportContact?: string;` and the same for `securityContact`; in `toRichProfilePatch`, before `if (input.links != null)`:

```ts
  for (const field of ["supportContact", "securityContact"] as const) {
    const raw = input[field];
    if (raw == null) continue;
    const contact = raw.trim();
    if (contact !== "" && !isContact(contact)) {
      throw new AppProfileInputError(field, `${field} must be an email address or an https URL of at most 200 characters`);
    }
    patch[field] = contact;
  }
```

`subgraphs/renown-stats/resolvers.ts`: in `profileWrite`, `scalars` gains `supportContact: patch.supportContact, securityContact: patch.securityContact,`; `AppProfileOutput` gains `supportContact: string | null; securityContact: string | null;` and `profileOutput` sets `supportContact: state.supportContact ?? null, securityContact: state.securityContact ?? null,` after `coverRef`.

`subgraphs/renown-stats/schema.ts`: `AppProfile` gains

```graphql
    "An email address or an https URL; render emails as mailto: links."
    supportContact: String
    "Where to report vulnerabilities: an email address or an https URL."
    securityContact: String
```

and `upsertAppProfile` gains the arguments `supportContact: String` and `securityContact: String` (before `links`, with the doc line "at most 200 characters, an email address or an https URL; empty clears").

- [ ] **Step 6: Run the tests, coverage, types, lint**

Run: `pnpm vitest run document-models/renown-app-profile subgraphs/renown-stats 2>&1 | grep -E "Test Files|Tests |FAIL"`
Expected: all pass.

Run: `pnpm vitest run --coverage 2>&1 | grep -E "All files|renown-app-profile.*profile.ts" && pnpm tsc 2>&1 | tail -3 && pnpm lint 2>&1 | tail -3`
Expected: coverage ≥ 95 everywhere (profile.ts at 100 % branches); clean.

- [ ] **Step 7: Commit**

```bash
git add document-models/renown-app-profile subgraphs/renown-stats
git commit -m "feat(app-profile): support and security contacts"
```

---

### Task 6: SDK helpers and the `@powerhousedao/renown-package/orgs` entry

**Files:**
- Modify: `sdk/orgs.ts` (append), `package.json` (`exports["./orgs"]`, `build`, `build:sdk`)
- Create: `sdk/tsconfig.json`
- Test: `sdk/tests/orgs.test.ts` (append)

**Interfaces:**
- Consumes: A1 `sdk/orgs.ts`; A2 `RELEASE_DOMAIN`/`RELEASE_TYPES` (pinned equal by test).
- Produces (all exported from `sdk/orgs.ts`): `interface OrgClaim { id; did; handle; name; role; teams; verifiedDomains }`, `orgsFromClaims(claims: unknown): OrgClaim[]`, `hasOrgRole(claims: unknown, orgIdOrHandle: string, minRole: string): boolean`, `verifyWebhookSignature(secret: string, header: string | null | undefined, rawBody: string, toleranceSec = 300, nowMs = Date.now()): Promise<boolean>`, `interface OrgMembershipView`, `fetchOrgMembership(endpoint: string, orgId: string, address: string, options?: { fetch?: typeof fetch; signal?: AbortSignal }): Promise<OrgMembershipView | null>`, `RELEASE_DOMAIN`, `RELEASE_TYPES`, `ORG_WEBHOOK_SIGNATURE_HEADER = "Renown-Signature"`.

- [ ] **Step 1: Write the failing tests**

Append to `sdk/tests/orgs.test.ts` (and add the new names to its import from `../orgs.js`, plus `import { RELEASE_DOMAIN as SERVER_DOMAIN, RELEASE_TYPES as SERVER_TYPES } from "../../subgraphs/renown-orgs/core/attestation.js";`):

```ts
const CLAIMS = {
  sub: "did:pkh:eip155:1:0xAbC0000000000000000000000000000000000001",
  orgs: [
    { id: "o1", did: "did:web:www.renown.id:org:o1", handle: "acme", name: "Acme", role: "PUBLISHER", teams: ["core"], verifiedDomains: ["acme.example"] },
    { id: "o2", did: "did:web:www.renown.id:org:o2", handle: "beta", name: "Beta", role: "owner", teams: [], verifiedDomains: [] },
    { id: "junk" },
    "nope",
  ],
};

describe("OIDC orgs claim helpers", () => {
  it("reads well-formed entries with uppercase roles and checks role thresholds by id or handle", () => {
    expect(orgsFromClaims(CLAIMS).map((o) => [o.id, o.role])).toEqual([["o1", "PUBLISHER"], ["o2", "OWNER"]]);
    expect(orgsFromClaims({})).toEqual([]);
    expect(orgsFromClaims(null)).toEqual([]);
    expect(hasOrgRole(CLAIMS, "o1", "PUBLISHER")).toBe(true);
    expect(hasOrgRole(CLAIMS, "ACME", "admin")).toBe(false);
    expect(hasOrgRole(CLAIMS, "beta", "ADMIN")).toBe(true);
    expect(hasOrgRole(CLAIMS, "gamma", "MEMBER")).toBe(false);
  });
});

describe("verifyWebhookSignature (receivers pin this vector)", () => {
  const body = '{"id":"e1","type":"ping","orgId":"o1","createdAt":"2026-10-12T12:00:00.000Z","data":{}}';
  const header = "t=1791806400,v1=d75d85f23b7a86faf73cdd020c6fa4436f53a1b646e17bc80d97e2299b4f4d17";
  const now = 1791806400 * 1000;

  it("accepts the vector and any of several v1 values", async () => {
    expect(await verifyWebhookSignature("whsec-test", header, body, 300, now)).toBe(true);
    expect(await verifyWebhookSignature("whsec-test", `t=1791806400,v1=${"0".repeat(64)},v1=d75d85f23b7a86faf73cdd020c6fa4436f53a1b646e17bc80d97e2299b4f4d17`, body, 300, now)).toBe(true);
  });

  it("rejects a changed body, a wrong secret, a stale or future timestamp and malformed headers", async () => {
    expect(await verifyWebhookSignature("whsec-test", header, body.replace("ping", "pong"), 300, now)).toBe(false);
    expect(await verifyWebhookSignature("other", header, body, 300, now)).toBe(false);
    expect(await verifyWebhookSignature("whsec-test", header, body, 300, now + 301_000)).toBe(false);
    expect(await verifyWebhookSignature("whsec-test", header, body, 300, now - 301_000)).toBe(false);
    for (const bad of [null, "", "v1=abc", "t=abc,v1=00", "t=1791806400"]) {
      expect(await verifyWebhookSignature("whsec-test", bad, body, 300, now)).toBe(false);
    }
  });
});

describe("fetchOrgMembership", () => {
  it("asks the renown-orgs endpoint and returns the membership or null; errors throw", async () => {
    const seen: { url: string; body: unknown }[] = [];
    const reply = (payload: unknown, status = 200) =>
      (async (url: string, init?: RequestInit) => {
        seen.push({ url, body: JSON.parse(String(init?.body)) });
        return new Response(JSON.stringify(payload), { status });
      }) as unknown as typeof fetch;
    const membership = { orgId: "o1", address: "0xabc", role: "PUBLISHER", status: "ACTIVE", appScope: { all: false, appDids: [] }, effectiveScope: { all: false, appDids: ["did:key:z1"] }, teams: ["core"] };
    expect(await fetchOrgMembership("https://sb.example/graphql/renown-orgs", "o1", "0xABC", { fetch: reply({ data: { orgMembership: membership } }) })).toEqual(membership);
    expect(seen[0]).toMatchObject({ url: "https://sb.example/graphql/renown-orgs", body: { variables: { orgId: "o1", address: "0xABC" } } });
    expect(await fetchOrgMembership("https://sb.example/graphql/renown-orgs", "o1", "0xabc", { fetch: reply({ data: { orgMembership: null } }) })).toBeNull();
    await expect(fetchOrgMembership("https://sb.example/graphql/renown-orgs", "o1", "0xabc", { fetch: reply({ errors: [{ message: "boom" }] }) })).rejects.toThrow("boom");
    await expect(fetchOrgMembership("https://sb.example/graphql/renown-orgs", "o1", "0xabc", { fetch: reply({}, 503) })).rejects.toThrow("503");
  });
});

describe("release attestation typed data", () => {
  it("matches what the server verifies", () => {
    expect(RELEASE_DOMAIN).toEqual(SERVER_DOMAIN);
    expect(RELEASE_TYPES).toEqual(SERVER_TYPES);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run sdk 2>&1 | grep -E "Tests |FAIL" | head -3`
Expected: fails (`orgsFromClaims` is not exported).

- [ ] **Step 3: Implement the helpers**

Append to `sdk/orgs.ts`:

```ts
/** The header renown-orgs signs webhook deliveries with. */
export const ORG_WEBHOOK_SIGNATURE_HEADER = "Renown-Signature";

/** EIP-712 domain and types of release attestations (as renown-orgs verifies them). */
export const RELEASE_DOMAIN = { name: "Renown Release", version: "1", chainId: 1 } as const;
export const RELEASE_TYPES = {
  ReleaseAttestation: [
    { name: "appDid", type: "string" },
    { name: "version", type: "string" },
    { name: "artifactDigest", type: "string" },
    { name: "orgId", type: "string" },
    { name: "issuedAt", type: "string" },
  ],
} as const;

/** One entry of the OIDC `orgs` claim. */
export interface OrgClaim {
  id: string;
  did: string;
  handle: string;
  name: string;
  role: OrgRole;
  teams: string[];
  verifiedDomains: string[];
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** The well-formed entries of an ID token's (or userinfo's) `orgs` claim, roles uppercased. */
export function orgsFromClaims(claims: unknown): OrgClaim[] {
  const orgs = (claims as { orgs?: unknown } | null)?.orgs;
  if (!Array.isArray(orgs)) return [];
  return orgs.flatMap((entry: unknown) => {
    const org = entry as Partial<Record<keyof OrgClaim, unknown>> | null;
    if (!org || typeof org !== "object") return [];
    const role = typeof org.role === "string" ? parseOrgRole(org.role) : null;
    if (typeof org.id !== "string" || typeof org.did !== "string" || typeof org.handle !== "string" || typeof org.name !== "string" || !role) {
      return [];
    }
    return [{ id: org.id, did: org.did, handle: org.handle, name: org.name, role, teams: strings(org.teams), verifiedDomains: strings(org.verifiedDomains) }];
  });
}

/** True when the claims list the organisation (by id, or handle case-insensitively) with at least `minRole`. */
export function hasOrgRole(claims: unknown, orgIdOrHandle: string, minRole: string): boolean {
  const wanted = orgIdOrHandle.trim();
  return orgsFromClaims(claims).some(
    (org) => (org.id === wanted || org.handle === wanted.toLowerCase()) && roleAtLeast(org.role, minRole),
  );
}

function hexOf(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function equalHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verifies a renown-orgs webhook delivery: `header` is the Renown-Signature
 * value `t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<rawBody>")>` (one
 * or more v1 values); the timestamp must be within `toleranceSec` of now.
 * Pass the raw request body, before any JSON parsing.
 */
export async function verifyWebhookSignature(
  secret: string,
  header: string | null | undefined,
  rawBody: string,
  toleranceSec = 300,
  nowMs: number = Date.now(),
): Promise<boolean> {
  if (!header) return false;
  let t: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [key, value] = part.trim().split("=", 2);
    if (key === "t" && value && /^\d+$/.test(value)) t = Number(value);
    else if (key === "v1" && value && /^[0-9a-f]{64}$/.test(value)) signatures.push(value);
  }
  if (t === null || signatures.length === 0) return false;
  if (Math.abs(nowMs / 1000 - t) > toleranceSec) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = hexOf(await crypto.subtle.sign("HMAC", key, encoder.encode(`${t}.${rawBody}`)));
  return signatures.some((signature) => equalHex(signature, expected));
}

/** What orgMembership answers for an ACTIVE membership. */
export interface OrgMembershipView {
  orgId: string;
  address: string;
  role: OrgRole;
  status: string;
  appScope: { all: boolean; appDids: string[] };
  effectiveScope: { all: boolean; appDids: string[] };
  teams: string[];
}

const MEMBERSHIP_QUERY = `query OrgMembership($orgId: String!, $address: String!) {
  orgMembership(orgId: $orgId, address: $address) {
    orgId address role status appScope { all appDids } effectiveScope { all appDids } teams
  }
}`;

/**
 * The ACTIVE membership of `address` in `orgId`, or null, from a renown-orgs
 * GraphQL endpoint (e.g. https://switchboard.renown.vetra.io/graphql/renown-orgs).
 * Throws on HTTP or GraphQL errors, so callers can fail closed.
 */
export async function fetchOrgMembership(
  endpoint: string,
  orgId: string,
  address: string,
  options: { fetch?: typeof fetch; signal?: AbortSignal } = {},
): Promise<OrgMembershipView | null> {
  const doFetch = options.fetch ?? fetch;
  const response = await doFetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: MEMBERSHIP_QUERY, variables: { orgId, address } }),
    signal: options.signal,
  });
  if (!response.ok) throw new Error(`renown-orgs answered HTTP ${response.status}`);
  const result = (await response.json()) as { data?: { orgMembership?: OrgMembershipView | null }; errors?: { message: string }[] };
  if (result.errors?.length) throw new Error(result.errors.map((error) => error.message).join("; "));
  return result.data?.orgMembership ?? null;
}
```

- [ ] **Step 4: Package the SDK**

Create `sdk/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "lib": ["ES2022", "DOM"],
    "types": [],
    "strict": true,
    "declaration": true,
    "skipLibCheck": true,
    "rootDir": ".",
    "outDir": "../dist/sdk"
  },
  "files": ["orgs.ts"]
}
```

In `package.json`: add to `"exports"` (after `"./pieces/*"`)

```json
    "./orgs": {
      "types": "./dist/sdk/orgs.d.ts",
      "default": "./dist/sdk/orgs.js"
    },
```

and in `"scripts"` change `"build": "ph-cli build"` to `"build": "ph-cli build && pnpm build:sdk"` and add `"build:sdk": "tsc -p sdk/tsconfig.json"`.

- [ ] **Step 5: Run the tests and build the entry**

Run: `pnpm vitest run sdk 2>&1 | grep -E "Tests |FAIL"`
Expected: all pass.

Run: `pnpm build:sdk && node -e "import('./dist/sdk/orgs.js').then((m) => console.log(Object.keys(m).sort().join(' ')))"`
Expected: `ORG_ROLES ORG_WEBHOOK_SIGNATURE_HEADER RELEASE_DOMAIN RELEASE_TYPES canonicalJson fetchOrgMembership hasOrgRole orgMessage orgsFromClaims parseOrgRole roleAtLeast sha256Hex verifyWebhookSignature`, and `dist/sdk/orgs.d.ts` exists.

Run: `pnpm tsc 2>&1 | tail -3 && pnpm lint 2>&1 | tail -3`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add sdk package.json
git commit -m "feat(sdk): organisation helpers exported as @powerhousedao/renown-package/orgs"
```

---

### Task 7: Staging smoke script, the complete API contract gate, rollout

**Files:**
- Create: `scripts/smoke/organisations.ts`
- Modify: `scripts/smoke/README.md` (append a section), `subgraphs/renown-orgs/tests/api-contract.test.ts` (`SHIPPED`)

**Interfaces:**
- Consumes: the whole renown-orgs surface (appendix of the A1 plan), `sdk/orgs.ts` (`orgMessage`).
- Produces: `node scripts/smoke/organisations.ts [--switchboard <url>] [--write] [--allow-prod]`, exit code 0/1.

- [ ] **Step 1: Close the contract**

In `subgraphs/renown-orgs/tests/api-contract.test.ts` set `const SHIPPED: readonly Phase[] = ["A1", "A2", "A3"];`.

Run: `pnpm vitest run subgraphs/renown-orgs/tests/api-contract.test.ts subgraphs/renown-orgs/tests/resolvers.test.ts 2>&1 | grep -E "Tests |FAIL"`
Expected: all pass — every field and type of the appendix is served with its exact signature, and every SDL field has a resolver.

- [ ] **Step 2: Write the smoke script**

Create `scripts/smoke/organisations.ts`:

```ts
/**
 * Smoke test of Renown organisations on a switchboard:
 *
 *   node scripts/smoke/organisations.ts [--switchboard <url>] [--write] [--allow-prod]
 *
 * Read-only checks (anonymous requests):
 *   1. orgHandleAvailability: "admin" and "orgs" are RESERVED, a fresh handle is available;
 *   2. organization(handle) of a missing handle is null;
 *   3. organizationSearch returns only listed, live organisations; limit 51 is BAD_USER_INPUT;
 *   4. orgCredentialStatus and orgInviteLink of unknown values are null;
 *   5. createOrganization and myNotifications without a caller are FORBIDDEN;
 *   6. OIDC discovery, when served, advertises the orgs scope and claim.
 * With --write (RENOWN_SMOKE_KEY: hex private key of a staging-only wallet), signed:
 *   7. creates or reuses the unlisted org @renown-smoke-<first 6 hex of the address>;
 *   8. creates, previews and revokes an invite link; creates and deletes a team;
 *      reads the audit log back.
 * Refuses non-staging hosts unless --allow-prod. Exits 1 on any failure.
 */
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type * as OrgsSdk from "../../sdk/orgs.js";

const ORGS_SDK = new URL("../../sdk/orgs.ts", import.meta.url).href;
const STAGING_SWITCHBOARD = "https://switchboard.renown-staging.vetra.io";
const PACKAGE = "/api/@powerhousedao/renown-package";
const REQUEST_TIMEOUT_MS = 15_000;

class SmokeFailure extends Error {}

interface Args {
  switchboard: string;
  write: boolean;
  allowProd: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { switchboard: STAGING_SWITCHBOARD, write: false, allowProd: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--switchboard") {
      const value = argv[++i];
      if (!value) throw new SmokeFailure("--switchboard needs a URL");
      args.switchboard = value;
    } else if (arg === "--write") args.write = true;
    else if (arg === "--allow-prod") args.allowProd = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("usage: organisations.ts [--switchboard <url>] [--write] [--allow-prod]");
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
  data?: T | null;
  errors?: { message: string; extensions?: { code?: string; field?: string } }[];
}

async function post<T>(endpoint: string, document: string, variables: unknown): Promise<GraphqlResult<T>> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: document, variables }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  try {
    return JSON.parse(text) as GraphqlResult<T>;
  } catch {
    throw new SmokeFailure(`GraphQL HTTP ${res.status}: ${clip(text)}`);
  }
}

async function query<T>(endpoint: string, document: string, variables: unknown = {}): Promise<T> {
  const result = await post<T>(endpoint, document, variables);
  if (result.errors?.length || !result.data) throw new SmokeFailure(`GraphQL: ${clip(JSON.stringify(result.errors ?? result))}`);
  return result.data;
}

async function expectCode(endpoint: string, document: string, variables: unknown, code: string): Promise<void> {
  const result = await post<unknown>(endpoint, document, variables);
  const got = result.errors?.[0]?.extensions?.code;
  check(got === code, `expected ${code}, got ${clip(JSON.stringify(result))}`);
}

async function readOnly(endpoint: string, switchboard: string): Promise<void> {
  const availability = `query A($h: String!) { orgHandleAvailability(handle: $h) { handle available reason } }`;
  for (const handle of ["admin", "orgs"]) {
    const { orgHandleAvailability: a } = await query<{ orgHandleAvailability: { available: boolean; reason: string | null } }>(endpoint, availability, { h: handle });
    check(!a.available && a.reason === "RESERVED", `${handle} should be RESERVED`);
  }
  const fresh = `smoke-free-${Date.now().toString(36)}`;
  const { orgHandleAvailability: free } = await query<{ orgHandleAvailability: { available: boolean } }>(endpoint, availability, { h: fresh });
  check(free.available, `${fresh} should be available`);
  step("handles", "reserved words refused, fresh handle available");

  const { organization } = await query<{ organization: unknown }>(endpoint, `query O($h: String) { organization(handle: $h) { id } }`, { h: fresh });
  check(organization === null, "a missing handle should resolve to null");

  const { organizationSearch } = await query<{ organizationSearch: { items: { listed: boolean; archived: boolean; takenDown: boolean }[] } }>(
    endpoint,
    `query S { organizationSearch(limit: 50) { items { listed archived takenDown } } }`,
  );
  check(organizationSearch.items.every((o) => o.listed && !o.archived && !o.takenDown), "search returned an unlisted or dead organization");
  await expectCode(endpoint, `query S { organizationSearch(limit: 51) { next } }`, {}, "BAD_USER_INPUT");
  step("directory", `${organizationSearch.items.length} listed organizations`);

  const unknown = await query<{ orgCredentialStatus: unknown; orgInviteLink: unknown }>(
    endpoint,
    `query U($c: String!, $t: String!) { orgCredentialStatus(credentialId: $c) { counts } orgInviteLink(token: $t) { usable } }`,
    { c: "urn:uuid:00000000-0000-4000-8000-000000000000", t: "not-a-token" },
  );
  check(unknown.orgCredentialStatus === null && unknown.orgInviteLink === null, "unknown credential and invite link should be null");

  await expectCode(endpoint, `mutation C { createOrganization(handle: "${fresh}", name: "x") { id } }`, {}, "FORBIDDEN");
  await expectCode(endpoint, `query N { myNotifications { next } }`, {}, "FORBIDDEN");
  step("anonymous writes and inbox", "FORBIDDEN");

  const discovery = await fetch(`${switchboard}${PACKAGE}/oidc/.well-known/openid-configuration`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (discovery.ok) {
    const d = (await discovery.json()) as { scopes_supported?: string[]; claims_supported?: string[] };
    check(d.scopes_supported?.includes("orgs") && d.claims_supported?.includes("orgs"), "OIDC discovery lacks the orgs scope or claim");
    step("oidc", "orgs scope and claim advertised");
  } else {
    step("oidc", `discovery not served (${discovery.status}); skipped`);
  }
}

async function writeFlow(endpoint: string, account: PrivateKeyAccount): Promise<void> {
  const { orgMessage } = (await import(ORGS_SDK)) as typeof OrgsSdk;
  async function signed<T>(field: string, document: string, variables: Record<string, unknown>): Promise<T> {
    const timestamp = new Date().toISOString();
    const orgId = typeof variables.orgId === "string" ? variables.orgId : null;
    const signature = await account.signMessage({ message: await orgMessage(field, orgId, variables, timestamp) });
    return query<T>(endpoint, document, { ...variables, auth: { address: account.address, signature, timestamp } });
  }

  const handle = `renown-smoke-${account.address.slice(2, 8).toLowerCase()}`;
  let { organization: org } = await query<{ organization: { id: string; createdBy: string } | null }>(
    endpoint,
    `query O($h: String) { organization(handle: $h) { id createdBy } }`,
    { h: handle },
  );
  if (!org) {
    const created = await signed<{ createOrganization: { id: string; createdBy: string } }>(
      "createOrganization",
      `mutation C($handle: String!, $name: String!, $listed: Boolean, $auth: OrgAuthInput) { createOrganization(handle: $handle, name: $name, listed: $listed, auth: $auth) { id createdBy } }`,
      { handle, name: "Renown smoke", listed: false },
    );
    org = created.createOrganization;
    step("org", `created @${handle}`);
  } else {
    step("org", `reusing @${handle}`);
  }
  check(org.createdBy === account.address.toLowerCase(), `@${handle} belongs to someone else`);
  const orgId = org.id;

  const link = await signed<{ createOrgInviteLink: { link: { id: string }; token: string } }>(
    "createOrgInviteLink",
    `mutation L($orgId: String!, $role: OrgRole!, $maxUses: Int!, $expiresAt: String!, $auth: OrgAuthInput) { createOrgInviteLink(orgId: $orgId, role: $role, maxUses: $maxUses, expiresAt: $expiresAt, auth: $auth) { link { id } token } }`,
    { orgId, role: "MEMBER", maxUses: 1, expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
  );
  const { orgInviteLink } = await query<{ orgInviteLink: { usable: boolean } | null }>(endpoint, `query P($t: String!) { orgInviteLink(token: $t) { usable } }`, {
    t: link.createOrgInviteLink.token,
  });
  check(orgInviteLink?.usable === true, "a fresh invite link should be usable");
  await signed(
    "revokeOrgInviteLink",
    `mutation R($orgId: String!, $linkId: String!, $auth: OrgAuthInput) { revokeOrgInviteLink(orgId: $orgId, linkId: $linkId, auth: $auth) { revoked } }`,
    { orgId, linkId: link.createOrgInviteLink.link.id },
  );
  step("invite link", "created, previewed, revoked");

  const team = await signed<{ createOrgTeam: { id: string } }>(
    "createOrgTeam",
    `mutation T($orgId: String!, $slug: String!, $name: String!, $auth: OrgAuthInput) { createOrgTeam(orgId: $orgId, slug: $slug, name: $name, auth: $auth) { id } }`,
    { orgId, slug: `smoke-${Date.now().toString(36)}`, name: "Smoke" },
  );
  await signed(
    "deleteOrgTeam",
    `mutation D($orgId: String!, $teamId: String!, $auth: OrgAuthInput) { deleteOrgTeam(orgId: $orgId, teamId: $teamId, auth: $auth) }`,
    { orgId, teamId: team.createOrgTeam.id },
  );
  step("team", "created and deleted");

  const audit = await signed<{ orgAuditLog: { items: { action: string }[] } }>(
    "orgAuditLog",
    `query A($orgId: String!, $limit: Int, $auth: OrgAuthInput) { orgAuditLog(orgId: $orgId, limit: $limit, auth: $auth) { items { action } } }`,
    { orgId, limit: 5 },
  );
  check(audit.orgAuditLog.items[0]?.action === "deleteOrgTeam", "the audit log should start with deleteOrgTeam");
  step("audit log", "records the smoke actions");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const host = new URL(args.switchboard).hostname;
  if (!/staging|localhost|127\.0\.0\.1/.test(host) && !args.allowProd) {
    throw new SmokeFailure(`${host} is not a staging host; pass --allow-prod to run against it`);
  }
  const endpoint = `${args.switchboard}/graphql/renown-orgs`;
  await readOnly(endpoint, args.switchboard);
  if (args.write) {
    const key = process.env.RENOWN_SMOKE_KEY?.trim();
    if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new SmokeFailure("--write needs RENOWN_SMOKE_KEY (0x + 64 hex)");
    await writeFlow(endpoint, privateKeyToAccount(key as `0x${string}`));
  }
  step("done", "all checks passed");
}

main().catch((error: unknown) => {
  console.error(`[smoke] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
```

Append to `scripts/smoke/README.md`:

````markdown
## organisations.ts

Checks the renown-orgs subgraph on a switchboard:

```sh
node scripts/smoke/organisations.ts                                  # Renown staging, read-only
RENOWN_SMOKE_KEY=0x… node scripts/smoke/organisations.ts --write     # plus signed writes on @renown-smoke-<addr>
node scripts/smoke/organisations.ts --switchboard <url> --allow-prod # a non-staging switchboard (read-only)
```

Read-only by default: reserved handles, the directory (only listed, live orgs), unknown credentials and invite
links, anonymous writes refused, the OIDC `orgs` scope. `--write` needs `RENOWN_SMOKE_KEY`, the private key of a
wallet used only for smoke tests; it creates (once) or reuses the unlisted org `@renown-smoke-<first 6 hex of the
address>`, then creates, previews and revokes an invite link, creates and deletes a team and reads the audit log
back, so repeated runs leave nothing behind but that one org.
````

- [ ] **Step 3: Check the script locally**

Run: `node scripts/smoke/organisations.ts --switchboard http://localhost:4001 2>&1 | tail -8` with a local switchboard (`pnpm reactor` in another terminal; skip if none is running).
Expected: `[smoke] done all checks passed` (the OIDC step reports "skipped" without signing keys).

Run: `pnpm tsc 2>&1 | tail -3 && pnpm lint 2>&1 | tail -3 && pnpm test 2>&1 | grep -E "Test Files|Tests " && pnpm vitest run --coverage 2>&1 | grep -E "All files"`
Expected: clean; everything passes; coverage ≥ 95 in every column.

- [ ] **Step 4: Commit**

```bash
git add scripts/smoke subgraphs/renown-orgs/tests/api-contract.test.ts
git commit -m "test(orgs): organisations smoke script and the complete API contract gate"
```

- [ ] **Step 5: Rollout**

1. Push `feat/organisations`; open a PR into `staging`; merge after CI.
2. Release on the staging channel; deploy the renown staging tenant with `RENOWN_ORG_DID_HOST=renown-staging.vetra.io` (and `RENOWN_PLATFORM_ADMINS` if it should differ from `ADMINS`). `RENOWN_WORKLOAD_KEY_ENCRYPTION_KEY` must already be set (webhooks).
3. Run `node scripts/smoke/organisations.ts` and `RENOWN_SMOKE_KEY=… node scripts/smoke/organisations.ts --write` against staging; both end with "all checks passed".
4. Hand B (renown.id) and C (Vetra) the A1 appendix as their contract; they go to staging next.
5. Only after B and C have passed staging: PR `staging` → `main`, release, deploy prod (`RENOWN_ORG_DID_HOST` unset → `www.renown.id`), run the read-only smoke with `--allow-prod`.
