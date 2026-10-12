import { PGlite } from "@electric-sql/pglite";
import { Kysely } from "kysely";
import { PGliteDialect } from "kysely-pglite-dialect";
import { KyselyOrgStore } from "./kysely.js";
import { migrate } from "./migrations.js";
import type { OrgsDB, OrgsKysely } from "./types.js";

/**
 * An OrgStore in process memory, for tests and local experiments: the same
 * KyselyOrgStore on an in-process PGlite, so there is no second
 * implementation to drift from the production one.
 */
export async function openMemoryOrgStore(): Promise<{ store: KyselyOrgStore; db: OrgsKysely; close(): Promise<void> }> {
  const db = new Kysely<OrgsDB>({ dialect: new PGliteDialect(new PGlite()) });
  await migrate(db);
  return { store: new KyselyOrgStore(db), db, close: () => db.destroy() };
}
