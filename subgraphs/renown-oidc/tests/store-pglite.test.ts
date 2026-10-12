import type { Kysely } from "kysely";
import { bootNamespace, openPglite } from "../../renown-stats/tests/host-namespace.js";
import { afterAll, describe, expect, it } from "vitest";
import { KyselyOidcStore } from "../store/kysely.js";
import { migrate, OIDC_NAMESPACE } from "../store/migrations.js";
import type { OidcDB } from "../store/types.js";
import { describeOidcStoreContract } from "./store-contract.js";

const opened: Kysely<OidcDB>[] = [];

afterAll(async () => {
  await Promise.all(opened.map((db) => db.destroy()));
});

/**
 * A fresh in-memory Postgres per store, opened through the host's real
 * `createRelationalDb` (hashed namespace) and migrated on two boots.
 */
async function makeKyselyStore(): Promise<KyselyOidcStore> {
  const root = openPglite<OidcDB>();
  opened.push(root);
  return new KyselyOidcStore(await bootNamespace<OidcDB>(root, OIDC_NAMESPACE, migrate));
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

describe("migrate under the host's hashed namespace", () => {
  it("adds allowed_orgs to a pre-organisations oidc_clients table and survives every later boot", async () => {
    const root = openPglite<OidcDB>();
    opened.push(root);
    // The table as main created it, before allowed_orgs existed.
    await bootNamespace<OidcDB>(
      root,
      OIDC_NAMESPACE,
      (db) =>
        db.schema
          .createTable("oidc_clients")
          .addColumn("client_id", "text", (col) => col.primaryKey())
          .addColumn("name", "text", (col) => col.notNull())
          .addColumn("redirect_uris", "text", (col) => col.notNull())
          .addColumn("allowed_subjects", "text", (col) => col.notNull())
          .addColumn("allow_any", "boolean", (col) => col.notNull().defaultTo(false))
          .addColumn("secret_hash", "text")
          .addColumn("status", "text", (col) => col.notNull())
          .addColumn("created_at", "timestamptz", (col) => col.notNull())
          .addColumn("updated_at", "timestamptz", (col) => col.notNull())
          .execute(),
      1,
    );
    const db = await bootNamespace<OidcDB>(root, OIDC_NAMESPACE, migrate, 3);
    const store = new KyselyOidcStore(db);
    await store.createClient({ id: "c", name: "C", redirectUris: [], allowedSubjects: [], allowAnySubject: false, clientSecretHash: null, status: "ACTIVE" }, new Date());
    expect(await db.selectFrom("oidc_clients").select(["client_id", "allowed_orgs"]).execute()).toEqual([{ client_id: "c", allowed_orgs: "[]" }]);
    expect((await store.getClient("c"))?.allowedOrgs).toBeUndefined();
  });
});
