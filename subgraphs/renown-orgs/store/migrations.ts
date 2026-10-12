import { sql, type Kysely } from "kysely";

/**
 * Creates the renown-orgs tables. Idempotent: it runs on every boot. Built
 * with the schema builder only, so `withSchema("renown-orgs")` applies to
 * every table and index (raw `sql` DDL would land in `public`).
 */
export async function migrate(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("organizations")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("handle", "text", (col) => col.notNull())
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("bio", "text")
    .addColumn("website", "text")
    .addColumn("avatar_ref", "text")
    .addColumn("links", "jsonb", (col) => col.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn("listed", "boolean", (col) => col.notNull().defaultTo(false))
    .addColumn("members_public", "boolean", (col) => col.notNull().defaultTo(false))
    .addColumn("archived", "boolean", (col) => col.notNull().defaultTo(false))
    .addColumn("taken_down", "boolean", (col) => col.notNull().defaultTo(false))
    .addColumn("created_by", "text", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) => col.notNull())
    .addColumn("updated_at", "timestamptz", (col) => col.notNull())
    .execute();
  await db.schema
    .createIndex("organizations_handle_lower")
    .ifNotExists()
    .unique()
    .on("organizations")
    .expression(sql`lower(handle)`)
    .execute();
  await db.schema.createIndex("organizations_created_by").ifNotExists().on("organizations").column("created_by").execute();
  await db.schema
    .createIndex("organizations_listed_handle")
    .ifNotExists()
    .on("organizations")
    .expression(sql`lower(handle) text_pattern_ops`)
    .where(sql.ref("listed"), "=", true)
    .execute();
  await db.schema
    .createIndex("organizations_listed_name")
    .ifNotExists()
    .on("organizations")
    .expression(sql`lower(name) text_pattern_ops`)
    .where(sql.ref("listed"), "=", true)
    .execute();

  await db.schema
    .createTable("org_members")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("org_id", "text", (col) => col.notNull())
    .addColumn("address", "text", (col) => col.notNull())
    .addColumn("role", "text", (col) => col.notNull())
    .addColumn("status", "text", (col) => col.notNull())
    .addColumn("app_scope_all", "boolean", (col) => col.notNull().defaultTo(false))
    .addColumn("app_dids", "jsonb", (col) => col.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn("hidden", "boolean", (col) => col.notNull().defaultTo(false))
    .addColumn("invited_by", "text")
    .addColumn("invited_at", "timestamptz", (col) => col.notNull())
    .addColumn("joined_at", "timestamptz")
    .addColumn("ended_at", "timestamptz")
    .addColumn("updated_at", "timestamptz", (col) => col.notNull())
    .execute();
  await db.schema.createIndex("org_members_org_status").ifNotExists().on("org_members").columns(["org_id", "status"]).execute();
  await db.schema.createIndex("org_members_address_status").ifNotExists().on("org_members").columns(["address", "status"]).execute();
  // One open (INVITED or ACTIVE) record per address and org; closed records are kept as history.
  await db.schema
    .createIndex("org_members_one_open")
    .ifNotExists()
    .unique()
    .on("org_members")
    .columns(["org_id", "address"])
    .where(sql<boolean>`status IN ('INVITED', 'ACTIVE')`)
    .execute();

  await db.schema
    .createTable("org_teams")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("org_id", "text", (col) => col.notNull())
    .addColumn("slug", "text", (col) => col.notNull())
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("app_dids", "jsonb", (col) => col.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn("created_at", "timestamptz", (col) => col.notNull())
    .execute();
  await db.schema.createIndex("org_teams_slug").ifNotExists().unique().on("org_teams").columns(["org_id", "slug"]).execute();
  await db.schema
    .createTable("org_team_members")
    .ifNotExists()
    .addColumn("team_id", "text", (col) => col.notNull())
    .addColumn("member_id", "text", (col) => col.notNull())
    .addPrimaryKeyConstraint("org_team_members_pk", ["team_id", "member_id"])
    .execute();
  await db.schema.createIndex("org_team_members_member").ifNotExists().on("org_team_members").column("member_id").execute();

  await db.schema
    .createTable("org_invite_links")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("org_id", "text", (col) => col.notNull())
    .addColumn("token_hash", "text", (col) => col.notNull().unique())
    .addColumn("role", "text", (col) => col.notNull())
    .addColumn("max_uses", "integer", (col) => col.notNull())
    .addColumn("uses", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("expires_at", "timestamptz", (col) => col.notNull())
    .addColumn("revoked", "boolean", (col) => col.notNull().defaultTo(false))
    .addColumn("created_by", "text", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) => col.notNull())
    .execute();
  await db.schema.createIndex("org_invite_links_org").ifNotExists().on("org_invite_links").column("org_id").execute();

  await db.schema
    .createTable("org_apps")
    .ifNotExists()
    .addColumn("app_did", "text", (col) => col.primaryKey())
    .addColumn("org_id", "text", (col) => col.notNull())
    .addColumn("frozen", "boolean", (col) => col.notNull().defaultTo(false))
    .addColumn("added_at", "timestamptz", (col) => col.notNull())
    .execute();
  await db.schema.createIndex("org_apps_org").ifNotExists().on("org_apps").column("org_id").execute();

  await db.schema
    .createTable("org_domains")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("org_id", "text", (col) => col.notNull())
    .addColumn("domain", "text", (col) => col.notNull())
    .addColumn("token", "text", (col) => col.notNull())
    .addColumn("status", "text", (col) => col.notNull())
    .addColumn("verified_at", "timestamptz")
    .addColumn("last_checked_at", "timestamptz")
    .addColumn("failures", "integer", (col) => col.notNull().defaultTo(0))
    .addColumn("created_at", "timestamptz", (col) => col.notNull())
    .execute();
  await db.schema.createIndex("org_domains_org").ifNotExists().on("org_domains").column("org_id").execute();
  await db.schema
    .createIndex("org_domains_org_domain")
    .ifNotExists()
    .unique()
    .on("org_domains")
    .expression(sql`org_id, lower(domain)`)
    .execute();
  // A domain is verified for at most one organization: the first verification wins.
  await db.schema
    .createIndex("org_domains_verified_once")
    .ifNotExists()
    .unique()
    .on("org_domains")
    .expression(sql`lower(domain)`)
    .where(sql.ref("status"), "=", "VERIFIED")
    .execute();

  await db.schema
    .createTable("org_audit")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("org_id", "text", (col) => col.notNull())
    .addColumn("at", "timestamptz", (col) => col.notNull())
    .addColumn("actor", "text", (col) => col.notNull())
    .addColumn("action", "text", (col) => col.notNull())
    .addColumn("details", "jsonb", (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    .execute();
  await db.schema.createIndex("org_audit_org_at").ifNotExists().on("org_audit").columns(["org_id", "at", "id"]).execute();

  await db.schema
    .createTable("reserved_handles")
    .ifNotExists()
    .addColumn("handle", "text", (col) => col.primaryKey())
    .addColumn("until", "timestamptz", (col) => col.notNull())
    .addColumn("reason", "text", (col) => col.notNull())
    .addColumn("org_id", "text")
    .execute();

  await db.schema
    .createTable("org_used_signatures")
    .ifNotExists()
    .addColumn("hash", "text", (col) => col.primaryKey())
    .addColumn("expires_at", "timestamptz", (col) => col.notNull())
    .execute();
}
