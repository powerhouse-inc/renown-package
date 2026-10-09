import type { IRelationalDb } from "@powerhousedao/reactor-browser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTIVE_WINDOW_MS, metricValue } from "../core/app-stats.js";
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

const anyString: string = expect.any(String) as string;
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
    expect(stats).toMatchObject({ appDid: APP, totalUsers: 7, activeUsers30d: 7, updatedAt: anyString });
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
    expect((await failure(r.appStats("not-a-did"))).code).toBe("BAD_USER_INPUT");
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
      { appDid: APP, metric: "notes", value: 4, updatedAt: anyString, appName: "Vault", appDocumentId: documentId, appHasLogo: false, appLogo: "https://cdn.example/vault.png", label: "Notes", unit: "notes" },
      { appDid: APP, metric: "raw", value: 2, updatedAt: anyString, appName: "Vault", appDocumentId: documentId, appHasLogo: false, appLogo: "https://cdn.example/vault.png", label: null, unit: null },
      { appDid: APP_2, metric: "x", value: 1, updatedAt: anyString, appName: null, appDocumentId: null, appHasLogo: false, appLogo: null, label: null, unit: null },
    ]);
  });
});

describe("appStats controller rules", () => {
  it("treats a report exactly 30 days old as active and one older as inactive", async () => {
    const now = new Date("2026-10-09T00:00:00Z");
    const r = harnessResolvers(h, { now: () => now });
    const at = (ms: number) => new Date(now.getTime() - ms);
    for (const [n, when] of [[1, at(ACTIVE_WINDOW_MS)], [2, at(ACTIVE_WINDOW_MS + 1000)]] as const) {
      await h.root
        .withSchema("renown-stats")
        .insertInto("app_metric_values")
        .values({ app_did: APP, metric: "m", user_did: user(n), value: 1, updated_at: when })
        .execute();
    }
    expect(await r.appStats(APP)).toMatchObject({ totalUsers: 2, activeUsers30d: 1 });
  });

  it("resolves all contributor profiles in one read-model query", async () => {
    let calls = 0;
    const relationalDb = {
      queryNamespace: (namespace: string) => {
        if (namespace === USER_NS) calls++;
        return h.root.withSchema(namespace);
      },
    } as unknown as IRelationalDb<unknown>;
    const r = harnessResolvers(h, { relationalDb });
    await r.upsert({ appDid: APP, metrics: [metric("a", "SUM"), metric("b", "MAX")] });
    for (let n = 1; n <= 4; n++) {
      await r.report({ appDid: APP, userDid: user(n), metric: "a", value: n });
      await r.report({ appDid: APP, userDid: user(n), metric: "b", value: n });
    }
    await r.appStats(APP);
    expect(calls).toBe(1);
  });

  it("answers SERVICE_UNAVAILABLE without the database error when the aggregate write fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const r = harnessResolvers(h);
    vi.spyOn(r.index, "recordMetricValues").mockRejectedValue(new Error("relation secret_table broke"));
    const error = await failure(r.report({ appDid: APP, userDid: user(1), metric: "m", value: 1 }));
    expect(error.code).toBe("SERVICE_UNAVAILABLE");
    expect(error.message).not.toContain("secret_table");
    expect(warn).toHaveBeenCalled();
  });
});
