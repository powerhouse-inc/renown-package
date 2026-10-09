import { buildASTSchema, parse, validate, type GraphQLInputObjectType } from "graphql";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { metricActions, toMetricsPatch, type AppMetric } from "../core/app-metrics-patch.js";
import { pkhDidFor } from "../core/dids.js";
import { schema } from "../schema.js";
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
      [{ ...NOTES, id: "i".repeat(129) }],
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
    for (const doc of r.reactor.docs.values()) delete (doc.state as unknown as { global: Record<string, unknown> }).global.metrics;
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
      { metric: "notes", users: 1, sum: 0, max: 0, avg: 0, positiveUsers: 0, top: [] },
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

describe("the Vetra relay contract for metrics", () => {
  // The document vetra-cloud-package (286c9f4,
  // subgraphs/vetra-licensing/renown-profile.ts) sends.
  const RELAY_UPSERT = `mutation UpsertAppProfile($appDid: String!, $name: String, $tagline: String, $website: String, $description: String, $category: String, $logoRef: String, $coverRef: String, $links: [AppProfileLinkInput!], $metrics: [AppMetricInput!]) {
  upsertAppProfile(appDid: $appDid, name: $name, tagline: $tagline, website: $website, description: $description, category: $category, logoRef: $logoRef, coverRef: $coverRef, links: $links, metrics: $metrics)
}`;

  it("validates against the schema and matches the relay's AppProfileMetricInput field for field", () => {
    const built = buildASTSchema(schema);
    expect(validate(built, parse(RELAY_UPSERT))).toEqual([]);
    const input = built.getType("AppMetricInput") as GraphQLInputObjectType;
    const fields = Object.fromEntries(
      Object.entries(input.getFields()).map(([name, f]) => [name, String(f.type)]),
    );
    expect(fields).toEqual({
      id: "String!",
      key: "String!",
      label: "String!",
      unit: "String",
      description: "String",
      aggregation: "RenownMetricAggregation!",
      public: "Boolean!",
    });
    const aggregation = built.getType("RenownMetricAggregation") as unknown as { getValues(): { name: string }[] };
    expect(aggregation.getValues().map((v) => v.name)).toEqual(["SUM", "MAX", "AVG", "COUNT_USERS"]);
    const arg = built.getMutationType()!.getFields().upsertAppProfile.args.find((a) => a.name === "metrics")!;
    expect(String(arg.type)).toBe("[AppMetricInput!]");
  });
});
