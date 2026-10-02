import { PGlite } from "@electric-sql/pglite";
import { Kysely, sql } from "kysely";
import { PGliteDialect } from "kysely-pglite-dialect";
import { afterAll } from "vitest";
import { KyselyWorkloadStore } from "../store/kysely.js";
import { migrate } from "../store/migrations.js";
import type { WorkloadDB } from "../store/types.js";
import { describeWorkloadStoreContract } from "./store-contract.js";

const opened: Kysely<WorkloadDB>[] = [];

afterAll(async () => {
  await Promise.all(opened.map((db) => db.destroy()));
});

/**
 * A fresh in-memory Postgres per store, scoped to a `renown-workload` schema
 * the way the host's `relationalDb.createNamespace` scopes it, migrated twice
 * to prove the migration is idempotent.
 */
async function makeKyselyStore(): Promise<KyselyWorkloadStore> {
  const root = new Kysely<WorkloadDB>({
    dialect: new PGliteDialect(new PGlite()),
  });
  opened.push(root);
  await sql`create schema "renown-workload"`.execute(root);
  const db = root.withSchema("renown-workload");
  await migrate(db);
  await migrate(db);
  return new KyselyWorkloadStore(db);
}

describeWorkloadStoreContract("KyselyWorkloadStore on PGlite", makeKyselyStore);
