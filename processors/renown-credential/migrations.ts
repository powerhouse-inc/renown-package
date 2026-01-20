import { type IRelationalDb } from "document-drive";

export async function up(db: IRelationalDb<any>): Promise<void> {
  await down(db);
  // Create renown_credential table with EIP-712 signed credential schema
  await db.schema
    .createTable("renown_credential")
    .addColumn("document_id", "varchar(255)")
    // W3C VC Fields
    .addColumn("context", "text", (col) => col.notNull()) // JSON array
    .addColumn("credential_id", "varchar(255)", (col) => col.notNull())
    .addColumn("type", "text", (col) => col.notNull()) // JSON array
    .addColumn("issuer_id", "varchar(255)", (col) => col.notNull())
    .addColumn("issuer_ethereum_address", "varchar(255)", (col) => col.notNull())
    .addColumn("issuance_date", "timestamp", (col) => col.notNull())
    .addColumn("expiration_date", "timestamp")
    .addColumn("credential_subject_id", "varchar(255)")
    .addColumn("credential_subject_app", "varchar(255)", (col) => col.notNull())
    .addColumn("credential_status_id", "varchar(255)")
    .addColumn("credential_status_type", "varchar(255)")
    .addColumn("credential_schema_id", "varchar(255)", (col) => col.notNull())
    .addColumn("credential_schema_type", "varchar(255)", (col) => col.notNull())
    // Proof fields (EIP-712)
    .addColumn("proof_verification_method", "text", (col) => col.notNull())
    .addColumn("proof_ethereum_address", "varchar(255)", (col) => col.notNull())
    .addColumn("proof_created", "timestamp", (col) => col.notNull())
    .addColumn("proof_purpose", "varchar(255)", (col) => col.notNull())
    .addColumn("proof_type", "varchar(255)", (col) => col.notNull())
    .addColumn("proof_value", "text", (col) => col.notNull()) // EIP-712 signature
    .addColumn("proof_eip712_domain", "text", (col) => col.notNull()) // JSON object
    .addColumn("proof_eip712_primary_type", "varchar(255)", (col) => col.notNull())
    // Revocation
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

  // Create index on issuer_id for faster lookups
  await db.schema
    .createIndex("idx_renown_credential_issuer_id")
    .on("renown_credential")
    .column("issuer_id")
    .ifNotExists()
    .execute();

  // Create index on issuer_ethereum_address for faster lookups
  await db.schema
    .createIndex("idx_renown_credential_issuer_eth")
    .on("renown_credential")
    .column("issuer_ethereum_address")
    .ifNotExists()
    .execute();

  // Create index on credential_subject_app for faster lookups
  await db.schema
    .createIndex("idx_renown_credential_subject_app")
    .on("renown_credential")
    .column("credential_subject_app")
    .ifNotExists()
    .execute();

  // Create index on proof_ethereum_address for faster lookups
  await db.schema
    .createIndex("idx_renown_credential_proof_eth")
    .on("renown_credential")
    .column("proof_ethereum_address")
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
    .dropIndex("idx_renown_credential_proof_eth")
    .ifExists()
    .execute();
  await db.schema
    .dropIndex("idx_renown_credential_subject_app")
    .ifExists()
    .execute();
  await db.schema
    .dropIndex("idx_renown_credential_issuer_eth")
    .ifExists()
    .execute();
  await db.schema
    .dropIndex("idx_renown_credential_issuer_id")
    .ifExists()
    .execute();
  await db.schema
    .dropIndex("idx_renown_credential_credential_id")
    .ifExists()
    .execute();

  // Drop renown_credential table with CASCADE to drop dependent objects
  await db.schema.dropTable("renown_credential").ifExists().cascade().execute();
}
