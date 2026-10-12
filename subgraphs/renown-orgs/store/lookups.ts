import { sql } from "kysely";
import type { ReadModelDb } from "../../renown-auth/lookups.js";
import { ORGS_NAMESPACE, type OrgRole, type OrgsDB } from "./types.js";

/**
 * Readers of the renown-orgs namespace for other subgraphs (renown-auth,
 * renown-read-model, renown-oidc, media). They import nothing of the
 * renown-orgs runtime, so there is no import cycle.
 */

/** Postgres "undefined table" or "invalid schema name": the renown-orgs namespace was never set up. */
export function isMissingNamespace(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "42P01" || code === "3F000";
}

function orgs(db: ReadModelDb) {
  return db.queryNamespace<OrgsDB>(ORGS_NAMESPACE);
}

/**
 * TAKEN when an organization holds `handle` (case-insensitively), RESERVED
 * while it is in reserved_handles, else null. A missing namespace reads as
 * null; any other error is thrown.
 */
export async function orgHandleStatus(db: ReadModelDb, handle: string, now: Date): Promise<"TAKEN" | "RESERVED" | null> {
  const wanted = handle.toLowerCase();
  try {
    const holder = await orgs(db)
      .selectFrom("organizations")
      .select("id")
      .where(sql<string>`lower(handle)`, "=", wanted)
      .executeTakeFirst();
    if (holder) return "TAKEN";
    const reserved = await orgs(db)
      .selectFrom("reserved_handles")
      .select("handle")
      .where("handle", "=", wanted)
      .where("until", ">", now)
      .executeTakeFirst();
    return reserved ? "RESERVED" : null;
  } catch (error) {
    if (isMissingNamespace(error)) return null;
    throw error;
  }
}

export interface PublicMembership {
  orgId: string;
  handle: string;
  name: string;
  role: OrgRole;
}

/** ACTIVE, non-hidden memberships of `address` in membersPublic organizations that are neither archived nor taken down. */
export async function publicMembershipsOf(db: ReadModelDb, address: string): Promise<PublicMembership[]> {
  try {
    const rows = await orgs(db)
      .selectFrom("org_members")
      .innerJoin("organizations", "organizations.id", "org_members.org_id")
      .select(["organizations.id as org_id", "organizations.handle", "organizations.name", "org_members.role"])
      .where("org_members.address", "=", address.toLowerCase())
      .where("org_members.status", "=", "ACTIVE")
      .where("org_members.hidden", "=", false)
      .where("organizations.members_public", "=", true)
      .where("organizations.archived", "=", false)
      .where("organizations.taken_down", "=", false)
      .orderBy("organizations.handle")
      .execute();
    return rows.map((row) => ({ orgId: row.org_id, handle: row.handle, name: row.name, role: row.role }));
  } catch (error) {
    if (isMissingNamespace(error)) return [];
    throw error;
  }
}

/** The avatar ref of a live (not taken down) organization, or null. Never throws. */
export async function orgAvatarRef(db: ReadModelDb, orgId: string): Promise<string | null> {
  try {
    const row = await orgs(db)
      .selectFrom("organizations")
      .select("avatar_ref")
      .where("id", "=", orgId)
      .where("taken_down", "=", false)
      .executeTakeFirst();
    return row?.avatar_ref ?? null;
  } catch {
    return null;
  }
}
