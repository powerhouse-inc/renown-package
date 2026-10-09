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
    expect(m).toBeDefined();
    expect(m.users).toBe(21);
    expect(m.top).toEqual([{ userDid: "hot", value: 109 }]);
  });

  it("completes opposite-order multi-row batches racing each other", async () => {
    const index = await makeIndex();
    const users = Array.from({ length: 30 }, (_, i) => `racer-${i}`);
    const batch = (list: string[], n: number) => list.map((u) => value(u, "m", n));
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => [
        index.recordMetricValues(batch(users, i)),
        index.recordMetricValues(batch([...users].reverse(), i)),
      ]).flat(),
    );
    const [m] = await index.metricAggregates(APP, ["m"], 1);
    expect(m.users).toBe(30);
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
