import type { Kysely } from "kysely";

/** Creates the `workload_identities` table and its later columns. Idempotent. */
export async function migrate(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("workload_identities")
    .ifNotExists()
    .addColumn("did", "text", (col) => col.primaryKey())
    .addColumn("provider", "text", (col) => col.notNull())
    .addColumn("repository_id", "text", (col) => col.notNull().unique())
    .addColumn("repository", "text", (col) => col.notNull())
    .addColumn("production_branch", "text", (col) => col.notNull())
    .addColumn("owner_address", "text", (col) => col.notNull())
    .addColumn("chain_id", "bigint", (col) => col.notNull())
    .addColumn("encrypted_key_pair", "text", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) => col.notNull())
    .addColumn("updated_at", "timestamptz", (col) => col.notNull())
    .execute();

  // Organisations: the owning org of a service account, and an admin kill switch.
  // Probe first: ADD COLUMN IF NOT EXISTS still takes an ACCESS EXCLUSIVE lock.
  const hasOrgColumns = await db
    .selectFrom("workload_identities")
    .select(["owner_org_id", "disabled"])
    .limit(0)
    .execute()
    .then(
      () => true,
      () => false,
    );
  if (!hasOrgColumns) {
    await db.schema
      .alterTable("workload_identities")
      .addColumn("owner_org_id", "text", (col) => col.ifNotExists())
      .execute();
    await db.schema
      .alterTable("workload_identities")
      .addColumn("disabled", "boolean", (col) =>
        col.ifNotExists().notNull().defaultTo(false),
      )
      .execute();
    await db.schema
      .createIndex("workload_identities_owner_org")
      .ifNotExists()
      .on("workload_identities")
      .column("owner_org_id")
      .execute();
  }
}
