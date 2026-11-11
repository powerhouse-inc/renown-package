import { PGlite } from "@electric-sql/pglite";
import { Kysely } from "kysely";
import { PGliteDialect } from "kysely-pglite-dialect";
import { bootNamespace } from "../../renown-stats/tests/host-namespace.js";
import { afterAll, expect, it } from "vitest";
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

it("gives identities stored before release branches an empty list", async () => {
  const root = new Kysely<WorkloadDB>({
    dialect: new PGliteDialect(new PGlite()),
  });
  opened.push(root);
  const db = await bootNamespace<WorkloadDB>(
    root,
    "renown-workload",
    migrate,
    1,
  );
  // The production table as it was: no release_branches column, one row.
  await db.schema
    .alterTable("workload_identities")
    .dropColumn("release_branches")
    .execute();
  await db
    .insertInto("workload_identities")
    .values({
      did: "did:key:old",
      provider: "github",
      repository_id: "1",
      repository: "acme/shop",
      production_branch: "main",
      owner_address: "0x1111111111111111111111111111111111111111",
      chain_id: 1,
      encrypted_key_pair: "v1.iv.ct",
      created_at: new Date(),
      updated_at: new Date(),
    })
    .execute();

  await migrate(db);

  const store = new KyselyWorkloadStore(db);
  expect((await store.getByDid("did:key:old"))?.releaseBranches).toEqual([]);
});
