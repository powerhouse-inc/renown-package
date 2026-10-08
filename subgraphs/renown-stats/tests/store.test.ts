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

/** A fresh PGlite scoped like `relationalDb.createNamespace("renown-stats")`, migrated twice. */
async function makeIndex(): Promise<KyselyStatsIndex> {
  const root = new Kysely<StatsDB>({ dialect: new PGliteDialect(new PGlite()) });
  opened.push(root);
  await sql`create schema "renown-stats"`.execute(root);
  const db = root.withSchema("renown-stats");
  await migrate(db);
  await migrate(db);
  return new KyselyStatsIndex(db);
}

const NOW = new Date("2026-10-08T10:00:00Z");
const LATER = new Date("2026-10-08T11:00:00Z");
const ALICE = "0xabc0000000000000000000000000000000000001";
const BOB = "0xb0b0000000000000000000000000000000000002";

describe("KyselyStatsIndex", () => {
  it("records one user-stats document per user DID: first claim wins", async () => {
    const index = await makeIndex();
    expect(await index.userStatsDocument("did:x")).toBeUndefined();
    expect(await index.claimUserStatsDocument("did:x", "doc-1", NOW)).toBe("doc-1");
    expect(await index.claimUserStatsDocument("did:x", "doc-2", NOW)).toBe("doc-1");
    expect(await index.userStatsDocument("did:x")).toBe("doc-1");
  });

  it("records one app profile per app DID: first claim wins, publisher included", async () => {
    const index = await makeIndex();
    expect(await index.appProfile("did:app")).toBeUndefined();
    const first = { appDid: "did:app", documentId: "p-1", publisherAddress: ALICE };
    expect(await index.claimAppProfile(first, NOW)).toEqual(first);
    expect(await index.claimAppProfile({ appDid: "did:app", documentId: "p-2", publisherAddress: BOB }, NOW)).toEqual(
      first,
    );
    expect(await index.appProfile("did:app")).toEqual(first);
  });

  it("lists a publisher's profiles oldest first and nobody else's", async () => {
    const index = await makeIndex();
    await index.claimAppProfile({ appDid: "did:b", documentId: "p-b", publisherAddress: ALICE }, LATER);
    await index.claimAppProfile({ appDid: "did:a", documentId: "p-a", publisherAddress: ALICE }, NOW);
    await index.claimAppProfile({ appDid: "did:c", documentId: "p-c", publisherAddress: BOB }, NOW);
    expect((await index.appProfilesByPublisher(ALICE)).map((e) => e.appDid)).toEqual(["did:a", "did:b"]);
    expect(await index.appProfilesByPublisher("0x0000000000000000000000000000000000000000")).toEqual([]);
  });
});
