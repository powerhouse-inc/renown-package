import { PGlite } from "@electric-sql/pglite";
import { Kysely, sql } from "kysely";
import { PGliteDialect } from "kysely-pglite-dialect";
import { afterAll } from "vitest";
import { KyselyOrgStore } from "../store/kysely.js";
import { openMemoryOrgStore } from "../store/memory.js";
import { migrate } from "../store/migrations.js";
import { ORGS_NAMESPACE, type OrgsDB } from "../store/types.js";
import { describeOrgStoreContract } from "./store-contract.js";

const closers: (() => Promise<void>)[] = [];
afterAll(async () => {
  await Promise.all(closers.map((close) => close()));
});

describeOrgStoreContract("memory org store", async () => {
  const opened = await openMemoryOrgStore();
  closers.push(() => opened.close());
  return opened;
});

describeOrgStoreContract("Kysely org store in the renown-orgs namespace", async () => {
  const root = new Kysely<OrgsDB>({ dialect: new PGliteDialect(new PGlite()) });
  closers.push(() => root.destroy());
  await sql`create schema ${sql.id(ORGS_NAMESPACE)}`.execute(root);
  const db = root.withSchema(ORGS_NAMESPACE);
  // Twice: migrate() runs on every boot.
  await migrate(db);
  await migrate(db);
  return { store: new KyselyOrgStore(db), db };
});
