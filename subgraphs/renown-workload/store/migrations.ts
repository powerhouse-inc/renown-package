import type { Kysely } from "kysely";

/** Creates the `workload_identities` table. Idempotent. */
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
}
