import { type IRelationalDb } from "document-drive/processors/types";

export async function up(db: IRelationalDb<any>): Promise<void> {
  await down(db);
  // Create renown_credential table
  await db.schema
    .createTable("renown_credential")
    .addColumn("document_id", "varchar(255)")
    .addColumn("context", "text") // JSON array
    .addColumn("credential_id", "varchar(255)")
    .addColumn("type", "text") // JSON array
    .addColumn("issuer", "varchar(255)", (col) => col.notNull())
    .addColumn("issuance_date", "timestamp", (col) => col.notNull())
    .addColumn("credential_subject", "text", (col) => col.notNull()) // JSON object
    .addColumn("expiration_date", "timestamp")
    .addColumn("credential_status_id", "varchar(255)")
    .addColumn("credential_status_type", "varchar(255)")
    .addColumn("credential_status_purpose", "varchar(255)")
    .addColumn("credential_status_list_index", "varchar(255)")
    .addColumn("credential_status_list_credential", "text")
    .addColumn("jwt", "text")
    .addColumn("revoked", "boolean", (col) => col.notNull().defaultTo(false))
    .addColumn("revoked_at", "timestamp")
    .addColumn("revocation_reason", "text")
    .addColumn("created_at", "timestamp", (col) => col.defaultTo(db.fn("now")))
    .addColumn("updated_at", "timestamp", (col) => col.defaultTo(db.fn("now")))
    .addPrimaryKeyConstraint("renown_credential_pkey", ["document_id"])
    .ifNotExists()
    .execute();

  // Create index on credential_id for faster lookups
  await db.schema
    .createIndex("idx_renown_credential_credential_id")
    .on("renown_credential")
    .column("credential_id")
    .ifNotExists()
    .execute();

  // Create index on issuer for faster lookups
  await db.schema
    .createIndex("idx_renown_credential_issuer")
    .on("renown_credential")
    .column("issuer")
    .ifNotExists()
    .execute();

  // Create index on credential_subject for faster lookups (using GIN for JSONB-like searches)
  await db.schema
    .createIndex("idx_renown_credential_subject")
    .on("renown_credential")
    .column("credential_subject")
    .ifNotExists()
    .execute();

  // Create index on revoked for faster validity checks
  await db.schema
    .createIndex("idx_renown_credential_revoked")
    .on("renown_credential")
    .column("revoked")
    .ifNotExists()
    .execute();
}

export async function down(db: IRelationalDb<any>): Promise<void> {
  // Drop renown_credential indexes
  await db.schema
    .dropIndex("idx_renown_credential_revoked")
    .ifExists()
    .execute();
  await db.schema
    .dropIndex("idx_renown_credential_subject")
    .ifExists()
    .execute();
  await db.schema
    .dropIndex("idx_renown_credential_issuer")
    .ifExists()
    .execute();
  await db.schema
    .dropIndex("idx_renown_credential_credential_id")
    .ifExists()
    .execute();

  // Drop renown_credential table
  await db.schema.dropTable("renown_credential").ifExists().execute();
}
