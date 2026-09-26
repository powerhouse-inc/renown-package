import { PGlite } from "@electric-sql/pglite";
import { Kysely, sql } from "kysely";
import { PGliteDialect } from "kysely-pglite-dialect";
import { afterAll } from "vitest";
import { KyselyOidcStore } from "../store/kysely.js";
import { migrate } from "../store/migrations.js";
import type { OidcDB } from "../store/types.js";
import { describeOidcStoreContract } from "./store-contract.js";

const opened: Kysely<OidcDB>[] = [];

afterAll(async () => {
  await Promise.all(opened.map((db) => db.destroy()));
});

/**
 * A fresh in-memory Postgres per store, scoped to a `renown-oidc` schema the
 * way the host's `relationalDb.createNamespace` scopes it, migrated twice to
 * prove the migration is idempotent.
 */
async function makeKyselyStore(): Promise<KyselyOidcStore> {
  const root = new Kysely<OidcDB>({ dialect: new PGliteDialect(new PGlite()) });
  opened.push(root);
  await sql`create schema "renown-oidc"`.execute(root);
  const db = root.withSchema("renown-oidc");
  await migrate(db);
  await migrate(db);
  return new KyselyOidcStore(db);
}

describeOidcStoreContract("KyselyOidcStore on PGlite", makeKyselyStore);
