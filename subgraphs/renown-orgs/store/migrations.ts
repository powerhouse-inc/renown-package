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

  // A2: proposals and timelocks.
  await db.schema
    .createTable("org_proposals")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("org_id", "text", (col) => col.notNull())
    .addColumn("kind", "text", (col) => col.notNull())
    .addColumn("payload", "jsonb", (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn("proposer", "text", (col) => col.notNull())
    .addColumn("approvals", "jsonb", (col) => col.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn("status", "text", (col) => col.notNull())
    .addColumn("threshold", "integer", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) => col.notNull())
    .addColumn("executable_at", "timestamptz")
    .addColumn("expires_at", "timestamptz", (col) => col.notNull())
    .addColumn("executed_at", "timestamptz")
    .addColumn("reason", "text")
    .execute();
  await db.schema.createIndex("org_proposals_org").ifNotExists().on("org_proposals").columns(["org_id", "created_at"]).execute();
  await db.schema.createIndex("org_proposals_status").ifNotExists().on("org_proposals").columns(["status", "executable_at"]).execute();
  // A2: the last claimed run of each sweep job, shared by every replica.
  await db.schema
    .createTable("org_jobs")
    .ifNotExists()
    .addColumn("name", "text", (col) => col.primaryKey())
    .addColumn("last_run_at", "timestamptz", (col) => col.notNull())
    .execute();
  // A2: when the sweeper last examined a proposal without progressing it (fair batching).
  await db.schema.alterTable("org_proposals").addColumn("checked_at", "timestamptz", (col) => col.ifNotExists()).execute();
  // A2: delegation credentials suspended by an organisation (admin action or a member's exit).
  await db.schema
    .createTable("org_credential_suspensions")
    .ifNotExists()
    .addColumn("org_id", "text", (col) => col.notNull())
    .addColumn("credential_id", "text", (col) => col.notNull())
    .addColumn("reason", "text", (col) => col.notNull())
    .addColumn("member_address", "text")
    .addColumn("at", "timestamptz", (col) => col.notNull())
    .addPrimaryKeyConstraint("org_credential_suspensions_pk", ["org_id", "credential_id"])
    .execute();
  // A2: member-level suspensions, kept apart from credential ids (which issuers choose).
  await db.schema
    .createTable("org_member_suspensions")
    .ifNotExists()
    .addColumn("org_id", "text", (col) => col.notNull())
    .addColumn("address", "text", (col) => col.notNull())
    .addColumn("suspended_at", "timestamptz", (col) => col.notNull())
    .addColumn("reason", "text", (col) => col.notNull())
    .addPrimaryKeyConstraint("org_member_suspensions_pk", ["org_id", "address"])
    .execute();
  // A2: app transfers; at most one PENDING per app.
  await db.schema
    .createTable("org_app_transfers")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("app_did", "text", (col) => col.notNull())
    .addColumn("from_kind", "text", (col) => col.notNull())
    .addColumn("from_id", "text", (col) => col.notNull())
    .addColumn("to_kind", "text", (col) => col.notNull())
    .addColumn("to_id", "text", (col) => col.notNull())
    .addColumn("status", "text", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) => col.notNull())
    .addColumn("expires_at", "timestamptz", (col) => col.notNull())
    .addColumn("decided_at", "timestamptz")
    .addColumn("decided_by", "text")
    .addColumn("proposal_id", "text")
    .execute();
  await db.schema
    .createIndex("org_app_transfers_one_pending")
    .ifNotExists()
    .unique()
    .on("org_app_transfers")
    .column("app_did")
    .where(sql.ref("status"), "=", "PENDING")
    .execute();
  await db.schema.alterTable("org_app_transfers").addColumn("reason", "text", (col) => col.ifNotExists()).execute();
  await db.schema.createIndex("org_app_transfers_from").ifNotExists().on("org_app_transfers").columns(["from_kind", "from_id"]).execute();
  await db.schema.createIndex("org_app_transfers_to").ifNotExists().on("org_app_transfers").columns(["to_kind", "to_id"]).execute();
  await db.schema.createIndex("org_app_transfers_due").ifNotExists().on("org_app_transfers").columns(["status", "expires_at"]).execute();
  // A2: release attestations; one per app, version and signer.
  await db.schema
    .createTable("org_release_attestations")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("app_did", "text", (col) => col.notNull())
    .addColumn("version", "text", (col) => col.notNull())
    .addColumn("artifact_digest", "text", (col) => col.notNull())
    .addColumn("org_id", "text", (col) => col.notNull())
    .addColumn("signer", "text", (col) => col.notNull())
    .addColumn("signer_role", "text")
    .addColumn("issued_at", "text", (col) => col.notNull())
    .addColumn("signature", "text", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) => col.notNull())
    .execute();
  await db.schema
    .createIndex("org_release_attestations_once")
    .ifNotExists()
    .unique()
    .on("org_release_attestations")
    .columns(["app_did", "version", "signer"])
    .execute();
  await db.schema.createIndex("org_release_attestations_app").ifNotExists().on("org_release_attestations").columns(["app_did", "created_at"]).execute();
  await db.schema.createIndex("org_release_attestations_org").ifNotExists().on("org_release_attestations").columns(["org_id", "created_at"]).execute();
  // A3: the in-app inbox.
  await db.schema
    .createTable("org_notifications")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("recipient", "text", (col) => col.notNull())
    .addColumn("kind", "text", (col) => col.notNull())
    .addColumn("org_id", "text", (col) => col.notNull())
    .addColumn("payload", "jsonb", (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn("created_at", "timestamptz", (col) => col.notNull())
    .addColumn("read_at", "timestamptz")
    .execute();
  await db.schema.createIndex("org_notifications_recipient").ifNotExists().on("org_notifications").columns(["recipient", "created_at", "id"]).execute();
  await db.schema.createIndex("org_notifications_created").ifNotExists().on("org_notifications").column("created_at").execute();
  // A3: delegation alerts: a processed-up-to mark per windowed job, and one alert per credential.
  await db.schema.alterTable("org_jobs").addColumn("watermark", "timestamptz", (col) => col.ifNotExists()).execute();
  await db.schema
    .createTable("org_delegation_alerts")
    .ifNotExists()
    .addColumn("credential_id", "text", (col) => col.primaryKey())
    .addColumn("org_id", "text", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) => col.notNull())
    .execute();
  await db.schema.createIndex("org_delegation_alerts_created").ifNotExists().on("org_delegation_alerts").column("created_at").execute();
}
