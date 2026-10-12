import { PGlite } from "@electric-sql/pglite";
import { Kysely, sql } from "kysely";
import { PGliteDialect } from "kysely-pglite-dialect";
import { afterAll, describe, expect, it } from "vitest";
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

describe("stored allowed_orgs", () => {
  it("drops entries with an unknown role", async () => {
    const store = await makeKyselyStore();
    await store.createClient({ id: "c", name: "C", redirectUris: [], allowedSubjects: [], allowAnySubject: false, clientSecretHash: null, status: "ACTIVE" }, new Date());
    const db = (store as unknown as { db: Kysely<OidcDB> }).db;
    await db.updateTable("oidc_clients").set({ allowed_orgs: JSON.stringify([{ orgId: "o1", minRole: "ROOT" }, { orgId: "o2", minRole: "ADMIN" }]) }).execute();
    expect((await store.getClient("c"))?.allowedOrgs).toEqual([{ orgId: "o2", minRole: "ADMIN" }]);
  });
});
