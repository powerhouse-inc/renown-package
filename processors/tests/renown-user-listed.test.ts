import { PGlite } from "@electric-sql/pglite";
import type { OperationWithContext } from "@powerhousedao/reactor-browser";
import { Kysely, sql } from "kysely";
import { PGliteDialect } from "kysely-pglite-dialect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RenownUserProcessor } from "../renown-user/index.js";
import { up } from "../renown-user/migrations.js";
import type { DB } from "../renown-user/schema.js";

const NS = "listed";
const FILTER = { branch: ["main"], documentId: ["*"], documentType: [], scope: ["global"] };
let root: Kysely<DB>;
let processor: RenownUserProcessor;

beforeAll(async () => {
  root = new Kysely<DB>({ dialect: new PGliteDialect(new PGlite()) });
  await sql`create schema ${sql.id(NS)}`.execute(root);
  // A table as it existed before `listed`: the old migration ran, one row exists.
  await up(root.withSchema(NS) as never);
  await sql`alter table ${sql.id(NS)}.renown_user drop column if exists listed`.execute(root);
  await root.withSchema(NS).insertInto("renown_user").values({
    document_id: "old", username: null, eth_address: null, user_image: null,
  } as never).execute();
  // Boot again: up() re-runs against the existing table.
  await up(root.withSchema(NS) as never);
  await up(root.withSchema(NS) as never);
  processor = new RenownUserProcessor(NS, FILTER, root.withSchema(NS) as never);
});

afterAll(async () => {
  await root.destroy();
});

let ordinal = 0;
function op(documentId: string, type: string, input: unknown, error?: string): OperationWithContext {
  ordinal += 1;
  return {
    operation: { index: ordinal, action: { type, input }, ...(error ? { error } : {}) },
    context: { documentId, documentType: "powerhouse/renown-user", scope: "global", branch: "main", ordinal },
  } as unknown as OperationWithContext;
}

async function listed(documentId: string): Promise<boolean> {
  const row = await root.withSchema(NS).selectFrom("renown_user").select("listed")
    .where("document_id", "=", documentId).executeTakeFirstOrThrow();
  return row.listed;
}

describe("renown-user read model: listed", () => {
  it("adds listed (default false) to an existing table on a re-run", async () => {
    expect(await listed("old")).toBe(false);
  });

  it("creates the partial prefix indexes for people search", async () => {
    const { rows } = await sql<{ indexname: string; indexdef: string }>`
      select indexname, indexdef from pg_indexes
      where schemaname = ${NS} and indexname like 'idx_renown_user_listed_%' order by indexname`.execute(root);
    expect(rows.map((r) => r.indexname)).toEqual([
      "idx_renown_user_listed_display_name",
      "idx_renown_user_listed_handle",
    ]);
    for (const { indexdef } of rows) {
      expect(indexdef).toMatch(/text_pattern_ops/);
      expect(indexdef).toMatch(/WHERE \(listed = true\)/);
    }
  });

  it("indexes SET_LISTED, creating the row when it is the first operation", async () => {
    await processor.onOperations([op("u1", "SET_LISTED", { listed: true })]);
    expect(await listed("u1")).toBe(true);
    await processor.onOperations([
      op("u1", "SET_LISTED", { listed: false }),
      op("u1", "SET_LISTED", { listed: true }, "SomeError"),
    ]);
    expect(await listed("u1")).toBe(false);
  });

  it("leaves listed alone for other operations", async () => {
    await processor.onOperations([
      op("u2", "SET_LISTED", { listed: true }),
      op("u2", "SET_DISPLAY_NAME", { displayName: "Ann" }),
      op("u2", "SET_HANDLE", { handle: "ann" }),
    ]);
    expect(await listed("u2")).toBe(true);
  });
});
