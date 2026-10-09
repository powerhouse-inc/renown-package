import { PGlite } from "@electric-sql/pglite";
import type { IReactorClient } from "@powerhousedao/reactor";
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
  const get = vi.fn((id: string) => (id in docs ? Promise.resolve(docs[id]) : Promise.reject(new Error(`no document ${id}`))));
  return { get, client: { get } as unknown as Pick<IReactorClient, "get"> };
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
    const result = await backfillAppMetricValues({ index, reactorClient: reactor.client, now, logger: quiet, pageSize: 1 });
    expect(result).toEqual({ status: "done", documents: 2, values: 3, failed: 0, skipped: 0 });
    expect(await index.jobDone(METRIC_BACKFILL_JOB)).toBe(true);
    const [notes] = await index.metricAggregates(APP, ["notes"], 5);
    expect(notes).toMatchObject({ users: 2, sum: 4, positiveUsers: 1 });
    expect(await index.appActivity(APP, new Date(T2))).toMatchObject({ totalUsers: 2, activeUsers: 2 });

    reactor.get.mockClear();
    expect(await backfillAppMetricValues({ index, reactorClient: reactor.client, now, logger: quiet })).toEqual({
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
    await backfillAppMetricValues({ index, reactorClient: reactor.client, now, logger: quiet });
    expect((await index.metricAggregates(APP, ["notes"], 1))[0]?.sum).toBe(9);
  });

  it("leaves the job open when a document cannot be read, and finishes on a later run", async () => {
    const { index } = await makeIndex();
    await index.claimUserStatsDocument(ALICE, "doc-a", now());
    await index.claimUserStatsDocument(BOB, "doc-b", now());
    const docs: Record<string, PHDocument> = { "doc-a": statsDoc(ALICE, [{ metric: "notes", value: 4, updatedAt: T1 }]) };
    const warn = vi.fn();
    const first = await backfillAppMetricValues({ index, reactorClient: reactorWith(docs).client, now, logger: { info: vi.fn(), warn } });
    expect(first).toEqual({ status: "incomplete", documents: 1, values: 1, failed: 1, skipped: 0 });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("doc-b"));
    expect(await index.jobDone(METRIC_BACKFILL_JOB)).toBe(false);

    docs["doc-b"] = statsDoc(BOB, [{ metric: "notes", value: 1, updatedAt: T2 }]);
    const second = await backfillAppMetricValues({ index, reactorClient: reactorWith(docs).client, now, logger: quiet });
    expect(second.status).toBe("done");
    // Re-copying Alice changed nothing: still one row per user.
    expect((await index.metricAggregates(APP, ["notes"], 5))[0]).toMatchObject({ users: 2, sum: 5 });
  });

  it("skips a stat with an invalid updatedAt, keeps the rest of the document and still completes", async () => {
    const { index } = await makeIndex();
    await index.claimUserStatsDocument(ALICE, "doc-a", now());
    const doc = statsDoc(ALICE, [
      { metric: "notes", value: 4, updatedAt: T1 },
      { metric: "bad", value: 1, updatedAt: T1 },
    ]);
    // The reducer validates DateTime, so corrupt the stored stat directly.
    (doc.state as unknown as { global: { stats: { metric: string; updatedAt: string }[] } }).global.stats.find(
      (stat) => stat.metric === "bad",
    )!.updatedAt = "not-a-date";
    const warn = vi.fn();
    const result = await backfillAppMetricValues({
      index,
      reactorClient: reactorWith({ "doc-a": doc }).client,
      now,
      logger: { info: vi.fn(), warn },
    });
    expect(result).toEqual({ status: "done", documents: 1, values: 1, failed: 0, skipped: 1 });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("skipped 1"));
    expect(await index.jobDone(METRIC_BACKFILL_JOB)).toBe(true);
    expect((await index.metricAggregates(APP, ["notes", "bad"], 5)).map((m) => m.metric)).toEqual(["notes"]);
  });
});
