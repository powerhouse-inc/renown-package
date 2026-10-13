import { RenownUserProcessor } from "../../../processors/renown-user/index.js";
import type { DB as RenownUserDB } from "../../../processors/renown-user/schema.js";
import type { ReadModelDb } from "../../renown-auth/lookups.js";
import { contributorProfiles, type ContributorProfile } from "../../renown-stats/lookups.js";

/** The lowercase wallet behind a user handle (newest profile), or undefined. Throws when the read model is unavailable. */
export async function addressOfHandle(db: ReadModelDb, handle: string): Promise<string | undefined> {
  const row = await RenownUserProcessor.query<RenownUserDB>("renown-user", db)
    .selectFrom("renown_user")
    .select("eth_address")
    .where((eb) => eb(eb.fn("LOWER", ["renown_user.handle"]), "=", handle.toLowerCase()))
    .orderBy("renown_user.created_at", "desc")
    .orderBy("renown_user.document_id", "desc")
    .executeTakeFirst();
  return row?.eth_address ? row.eth_address.toLowerCase() : undefined;
}

/** Profile cards of lowercase addresses; empty when the read model cannot be read (members still list). */
export async function profilesOf(db: ReadModelDb, addresses: readonly string[]): Promise<Map<string, ContributorProfile>> {
  try {
    return await contributorProfiles(db, addresses);
  } catch {
    return new Map();
  }
}
