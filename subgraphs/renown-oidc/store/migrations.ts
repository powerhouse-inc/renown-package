import type { Kysely } from "kysely";

/** Creates the `login_requests`, `auth_codes` and `access_tokens` tables. Idempotent. */
export async function migrate(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("login_requests")
    .ifNotExists()
    .addColumn("id", "varchar(255)", (col) => col.primaryKey())
    .addColumn("client_id", "varchar(255)", (col) => col.notNull())
    .addColumn("redirect_uri", "varchar(2048)", (col) => col.notNull())
    .addColumn("scope", "varchar(1024)", (col) => col.notNull())
    .addColumn("state", "varchar(1024)")
    .addColumn("nonce", "varchar(1024)")
    .addColumn("code_challenge", "varchar(1024)")
    .addColumn("siwe_nonce", "varchar(255)", (col) => col.notNull())
    .addColumn("expires_at", "timestamptz", (col) => col.notNull())
    .execute();

  await db.schema
    .createTable("auth_codes")
    .ifNotExists()
    .addColumn("code_hash", "varchar(255)", (col) => col.primaryKey())
    .addColumn("client_id", "varchar(255)", (col) => col.notNull())
    .addColumn("redirect_uri", "varchar(2048)", (col) => col.notNull())
    .addColumn("sub", "varchar(255)", (col) => col.notNull())
    .addColumn("address", "varchar(255)", (col) => col.notNull())
    .addColumn("chain_id", "bigint", (col) => col.notNull())
    .addColumn("nonce", "varchar(1024)")
    .addColumn("code_challenge", "varchar(1024)")
    .addColumn("scope", "varchar(1024)", (col) => col.notNull())
    .addColumn("auth_time", "timestamptz", (col) => col.notNull())
    .addColumn("expires_at", "timestamptz", (col) => col.notNull())
    .addColumn("used_at", "timestamptz")
    .execute();

  await db.schema
    .createTable("access_tokens")
    .ifNotExists()
    .addColumn("token_hash", "varchar(255)", (col) => col.primaryKey())
    .addColumn("code_hash", "varchar(255)", (col) => col.notNull())
    .addColumn("client_id", "varchar(255)", (col) => col.notNull())
    .addColumn("sub", "varchar(255)", (col) => col.notNull())
    .addColumn("address", "varchar(255)", (col) => col.notNull())
    .addColumn("scope", "varchar(1024)", (col) => col.notNull())
    .addColumn("expires_at", "timestamptz", (col) => col.notNull())
    .addColumn("revoked", "boolean", (col) => col.notNull().defaultTo(false))
    .execute();

  await db.schema
    .createIndex("access_tokens_code_hash_idx")
    .ifNotExists()
    .on("access_tokens")
    .column("code_hash")
    .execute();
}
