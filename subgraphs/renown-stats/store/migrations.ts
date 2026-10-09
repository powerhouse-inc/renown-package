import type { Kysely } from "kysely";

/** Creates the index tables. Idempotent. */
export async function migrate(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("user_stats_documents")
    .ifNotExists()
    .addColumn("user_did", "text", (col) => col.primaryKey())
    .addColumn("document_id", "text", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) => col.notNull())
    .execute();
  await db.schema
    .createTable("app_profile_documents")
    .ifNotExists()
    .addColumn("app_did", "text", (col) => col.primaryKey())
    .addColumn("document_id", "text", (col) => col.notNull())
    .addColumn("publisher_address", "text", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) => col.notNull())
    .execute();
  await db.schema
    .createIndex("app_profile_documents_publisher_address")
    .ifNotExists()
    .on("app_profile_documents")
    .column("publisher_address")
    .execute();
  // Phase 2: the uploaded logo/cover of each profile document, for the
  // public media route, and newest-first listings.
  await db.schema
    .createTable("app_profile_images")
    .ifNotExists()
    .addColumn("document_id", "text", (col) => col.primaryKey())
    .addColumn("logo_ref", "text")
    .addColumn("cover_ref", "text")
    .addColumn("updated_at", "timestamptz", (col) => col.notNull())
    .execute();
  await db.schema
    .createIndex("app_profile_documents_created_at")
    .ifNotExists()
    .on("app_profile_documents")
    .columns(["created_at", "app_did"])
    .execute();
}
