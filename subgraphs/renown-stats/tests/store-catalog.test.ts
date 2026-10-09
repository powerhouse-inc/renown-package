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

  it("trims the category filter, so a padded filter matches the same rows", async () => {
    const { index } = await makeIndex();
    await profile(index, "did:key:zA", 1, "DeFi");
    await profile(index, "did:key:zB", 2, "Games");
    await profile(index, "did:key:zC", 3, "defi");
    const plain = await index.appProfilesPage(10, undefined, "defi");
    expect(plain.map((e) => e.appDid)).toEqual(["did:key:zC", "did:key:zA"]);
    expect(await index.appProfilesPage(10, undefined, " DeFi ")).toEqual(plain);
  });

  it("trims a category on write: blank stores null, padded keeps the name", async () => {
    const { index, db } = await makeIndex();
    await profile(index, "did:key:zA", 1, null);
    const read = () => db.selectFrom("app_profile_documents").select(["app_did", "category"]).execute();
    await index.setAppCategory("did:key:zA", "  ");
    expect(await read()).toEqual([{ app_did: "did:key:zA", category: null }]);
    await index.setAppCategory("did:key:zA", " Games ");
    expect(await read()).toEqual([{ app_did: "did:key:zA", category: "Games" }]);
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
