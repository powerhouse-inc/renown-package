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
