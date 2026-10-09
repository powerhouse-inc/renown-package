import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_CATEGORIES_TTL_MS } from "../resolvers.js";
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

describe("appProfileCategories cache", () => {
  const T0 = new Date("2026-10-09T12:00:00Z");
  function clock() {
    let t = T0.getTime();
    return { now: () => new Date(t), advance: (ms: number) => (t += ms) };
  }

  it("serves one scan within the TTL and recomputes after it", async () => {
    const c = clock();
    const r = harnessResolvers(h, { now: c.now });
    const scan = vi.spyOn(r.index, "appProfileCategories");
    await r.index.claimAppProfile({ appDid: APP, documentId: "d1", publisherAddress: "0xabc" }, T0);
    await r.index.setAppCategory(APP, "DeFi");
    expect(await r.appProfileCategories()).toEqual([{ category: "DeFi", count: 1 }]);
    await r.index.claimAppProfile({ appDid: APP_2, documentId: "d2", publisherAddress: "0xabc" }, T0);
    await r.index.setAppCategory(APP_2, "Games");
    c.advance(APP_CATEGORIES_TTL_MS - 1);
    expect(await r.appProfileCategories()).toEqual([{ category: "DeFi", count: 1 }]);
    expect(scan).toHaveBeenCalledTimes(1);
    c.advance(1);
    expect(await r.appProfileCategories()).toHaveLength(2);
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it("shares one scan between concurrent requests", async () => {
    const r = harnessResolvers(h, { now: clock().now });
    const scan = vi.spyOn(r.index, "appProfileCategories");
    await Promise.all([r.appProfileCategories(), r.appProfileCategories()]);
    expect(scan).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failure", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const r = harnessResolvers(h, { now: clock().now });
    const scan = vi.spyOn(r.index, "appProfileCategories").mockRejectedValueOnce(new Error("db down"));
    expect((await failure(r.appProfileCategories())).code).toBe("SERVICE_UNAVAILABLE");
    expect(await r.appProfileCategories()).toEqual([]);
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it("is invalidated by a save that changes a category", async () => {
    const c = clock();
    const r = harnessResolvers(h, { now: c.now });
    await r.upsert({ appDid: APP, name: "One", category: "DeFi" });
    expect(await r.appProfileCategories()).toEqual([{ category: "DeFi", count: 1 }]);
    await r.upsert({ appDid: APP, category: "Games" });
    expect(await r.appProfileCategories()).toEqual([{ category: "Games", count: 1 }]);
  });
});

describe("upsertAppProfile category index failure", () => {
  it("reports the app index, not the image index, and logs its own line", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const r = harnessResolvers(h);
    vi.spyOn(r.index, "setAppCategory").mockRejectedValue(new Error("db down"));
    expect(await failure(r.upsert({ appDid: APP, name: "One", category: "DeFi" }))).toEqual({
      code: "SERVICE_UNAVAILABLE",
      field: undefined,
      message: "App index is temporarily unavailable",
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("app category index write failed (db down)"));
  });
});
