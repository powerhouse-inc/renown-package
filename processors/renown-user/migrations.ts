import type { IRelationalDb } from "@powerhousedao/reactor-browser";
import { sql } from "kysely";

export async function up(db: IRelationalDb<any>): Promise<void> {
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

  // Expression index matching the resolver's LOWER(eth_address) lookup so the
  // case-insensitive match stays an index scan.
  await db.schema
    .createIndex("idx_renown_user_eth_address_lower")
    .on("renown_user")
    .expression(sql`LOWER(eth_address)`)
    .ifNotExists()
    .execute();

  // Drop the plain-column eth_address index superseded by the LOWER() one above;
  // resolvers filter eth_address only via LOWER, so the raw index is unused.
  await db.schema
    .dropIndex("idx_renown_user_eth_address")
    .ifExists()
    .execute();
}

export async function down(db: IRelationalDb<any>): Promise<void> {
  // Drop renown_user indexes
  await db.schema
    .dropIndex("idx_renown_user_eth_address_lower")
    .ifExists()
    .execute();
  await db.schema.dropIndex("idx_renown_user_eth_address").ifExists().execute();
  await db.schema.dropIndex("idx_renown_user_username").ifExists().execute();

  // Drop renown_user table with CASCADE to drop dependent objects
  await db.schema.dropTable("renown_user").ifExists().cascade().execute();
}
