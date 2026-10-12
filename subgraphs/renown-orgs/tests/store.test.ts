import { PGlite } from "@electric-sql/pglite";
import { Kysely, sql } from "kysely";
import { PGliteDialect } from "kysely-pglite-dialect";
import { bootNamespace, hostSchema } from "../../renown-stats/tests/host-namespace.js";
import { afterAll, expect } from "vitest";
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
  const schema = hostSchema(ORGS_NAMESPACE);
  const publicTables = () =>
    sql<{ table_name: string }>`select table_name from information_schema.tables where table_schema = 'public' order by 1`
      .execute(root)
      .then((r) => r.rows.map((row) => row.table_name));
  const before = await publicTables();
  // Through the host's hashed namespace, on two boots: migrate() runs on every boot.
  const db = await bootNamespace<OrgsDB>(root, ORGS_NAMESPACE, migrate);
  // Every table and index lands in the namespace, none in public.
  expect(await publicTables()).toEqual(before);
  const inNamespace = await sql<{ n: number }>`select count(*)::int as n from information_schema.tables where table_schema = ${schema}`.execute(root);
  expect(inNamespace.rows[0]?.n).toBe(22);
  return { store: new KyselyOrgStore(db), db };
});
