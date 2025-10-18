import { type IRelationalDb } from "document-drive/processors/types";

export async function up(db: IRelationalDb<any>): Promise<void> {
  await down(db);
  // Create renown_user table
  await db.schema
    .createTable("renown_user")
    .addColumn("document_id", "varchar(255)")
    .addColumn("username", "varchar(255)")
    .addColumn("eth_address", "varchar(42)")
    .addColumn("user_image", "text")
    .addColumn("created_at", "timestamp", (col) => col.defaultTo(db.fn("now")))
    .addColumn("updated_at", "timestamp", (col) => col.defaultTo(db.fn("now")))
    .addPrimaryKeyConstraint("renown_user_pkey", ["document_id"])
    .ifNotExists()
    .execute();

  // Create index on username for faster lookups
  await db.schema
    .createIndex("idx_renown_user_username")
    .on("renown_user")
    .column("username")
    .ifNotExists()
    .execute();

  // Create index on eth_address for faster lookups
  await db.schema
    .createIndex("idx_renown_user_eth_address")
    .on("renown_user")
    .column("eth_address")
    .ifNotExists()
    .execute();

  // Create authorization table
  await db.schema
    .createTable("authorization")
    .addColumn("id", "varchar(255)")
    .addColumn("document_id", "varchar(255)", (col) => col.notNull())
    .addColumn("jwt", "text", (col) => col.notNull())
    .addColumn("issuer", "varchar(255)")
    .addColumn("subject", "varchar(255)")
    .addColumn("audience", "varchar(255)")
    .addColumn("payload", "text")
    .addColumn("revoked", "boolean", (col) => col.notNull().defaultTo(false))
    .addColumn("created_at", "timestamp")
    .addColumn("revoked_at", "timestamp")
    .addPrimaryKeyConstraint("authorization_pkey", ["id"])
    .addForeignKeyConstraint(
      "authorization_document_id_fkey",
      ["document_id"],
      "renown_user",
      ["document_id"],
      (cb) => cb.onDelete("cascade")
    )
    .ifNotExists()
    .execute();

  // Create index on document_id for faster lookups
  await db.schema
    .createIndex("idx_authorization_document_id")
    .on("authorization")
    .column("document_id")
    .ifNotExists()
    .execute();

  // Create index on jwt for faster token lookups
  await db.schema
    .createIndex("idx_authorization_jwt")
    .on("authorization")
    .column("jwt")
    .ifNotExists()
    .execute();

  // Create index on revoked for faster validity checks
  await db.schema
    .createIndex("idx_authorization_revoked")
    .on("authorization")
    .column("revoked")
    .ifNotExists()
    .execute();
}

export async function down(db: IRelationalDb<any>): Promise<void> {
  // Drop authorization indexes
  await db.schema.dropIndex("idx_authorization_revoked").ifExists().execute();
  await db.schema.dropIndex("idx_authorization_jwt").ifExists().execute();
  await db.schema.dropIndex("idx_authorization_document_id").ifExists().execute();

  // Drop authorization table (must be before renown_user due to foreign key)
  await db.schema.dropTable("authorization").ifExists().execute();

  // Drop renown_user indexes
  await db.schema.dropIndex("idx_renown_user_eth_address").ifExists().execute();
  await db.schema.dropIndex("idx_renown_user_username").ifExists().execute();

  // Drop renown_user table
  await db.schema.dropTable("renown_user").ifExists().execute();
}
