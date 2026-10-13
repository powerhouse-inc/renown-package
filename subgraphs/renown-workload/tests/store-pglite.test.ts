import { PGlite } from "@electric-sql/pglite";
import { Kysely } from "kysely";
import { PGliteDialect } from "kysely-pglite-dialect";
import { bootNamespace } from "../../renown-stats/tests/host-namespace.js";
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
  const db = await bootNamespace<WorkloadDB>(root, "renown-workload", migrate);
  return new KyselyWorkloadStore(db);
}

describeWorkloadStoreContract("KyselyWorkloadStore on PGlite", makeKyselyStore);
