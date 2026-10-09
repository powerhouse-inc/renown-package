import { RenownCredentialProcessor } from "../../processors/renown-credential/index.js";
import type { DB as RenownCredentialDB } from "../../processors/renown-credential/schema.js";
import type { ReadModelDb } from "../renown-auth/lookups.js";
import type { WorkloadDB } from "../renown-workload/store/types.js";
import { RenownUserProcessor } from "../../processors/renown-user/index.js";
import type { DB as RenownUserDB } from "../../processors/renown-user/schema.js";

/**
 * True when `address` holds an unrevoked, unexpired Renown credential
 * delegating to `appDid`: the same fact the host checks before it accepts a
 * bearer issued by `appDid` for `address`.
 */
export async function hasDelegation(
  db: ReadModelDb,
  address: string,
  appDid: string,
  now: Date,
): Promise<boolean> {
  const row = await RenownCredentialProcessor.query<RenownCredentialDB>(
    "renown-credential",
    db,
  )
    .selectFrom("renown_credential")
    .select("document_id")
    .where((eb) =>
      eb(
        eb.fn("LOWER", ["issuer_ethereum_address"]),
        "=",
        address.toLowerCase(),
      ),
    )
    .where("credential_subject_id", "=", appDid)
    .where("revoked", "=", false)
    .where((eb) =>
      eb.or([
        eb("expiration_date", "is", null),
        eb("expiration_date", ">", now),
      ]),
    )
    .executeTakeFirst();
  return row !== undefined;
}

/** The relational namespace renown-workload keeps its identities in (read-only here). */
export const WORKLOAD_NAMESPACE = "renown-workload";

/**
 * The lowercase owner address of the server-held workload identity `appDid`,
 * or undefined when `appDid` is not a registered identity. This, not a
 * delegation credential (which any wallet can self-publish to any did:key),
 * is what proves who an app DID belongs to.
 */
export async function workloadOwner(
  db: ReadModelDb,
  appDid: string,
): Promise<string | undefined> {
  const row = await db
    .queryNamespace<WorkloadDB>(WORKLOAD_NAMESPACE)
    .selectFrom("workload_identities")
    .select("owner_address")
    .where("did", "=", appDid)
    .executeTakeFirst();
  return row?.owner_address.toLowerCase();
}

/** What appStats shows of a contributor (Phase 1 read model). */
export interface ContributorProfile {
  documentId: string;
  handle: string | null;
  displayName: string | null;
  hasAvatar: boolean;
  avatar: string | null;
  userImage: string | null;
}

/**
 * The Renown profiles behind lowercase wallet addresses, keyed by address.
 * With several profile documents for one address the newest wins (as the
 * profile readers choose). Throws when the read model is unavailable.
 */
export async function contributorProfiles(
  db: ReadModelDb,
  addresses: readonly string[],
): Promise<Map<string, ContributorProfile>> {
  const out = new Map<string, ContributorProfile>();
  if (addresses.length === 0) return out;
  const rows = await RenownUserProcessor.query<RenownUserDB>("renown-user", db)
    .selectFrom("renown_user")
    .select(["document_id", "eth_address", "handle", "display_name", "avatar_ref", "user_image"])
    .where((eb) => eb(eb.fn("LOWER", ["renown_user.eth_address"]), "in", [...addresses]))
    .orderBy("renown_user.created_at", "desc")
    .orderBy("renown_user.document_id", "desc")
    .execute();
  for (const row of rows) {
    const address = row.eth_address?.toLowerCase();
    if (!address || out.has(address)) continue;
    out.set(address, {
      documentId: row.document_id,
      handle: row.handle,
      displayName: row.display_name,
      hasAvatar: row.avatar_ref !== null,
      avatar: row.avatar_ref,
      userImage: row.user_image,
    });
  }
  return out;
}
