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
}

export async function down(db: IRelationalDb<any>): Promise<void> {
  // Drop renown_user indexes
  await db.schema.dropIndex("idx_renown_user_eth_address").ifExists().execute();
  await db.schema.dropIndex("idx_renown_user_username").ifExists().execute();

  // Drop renown_user table
  await db.schema.dropTable("renown_user").ifExists().execute();
}
