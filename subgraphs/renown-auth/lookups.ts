import type { IRelationalDb } from "@powerhousedao/reactor-browser";
import { RenownCredentialProcessor } from "../../processors/renown-credential/index.js";
import type { DB as RenownCredentialDB } from "../../processors/renown-credential/schema.js";
import { RenownUserProcessor } from "../../processors/renown-user/index.js";
import type { DB as RenownUserDB } from "../../processors/renown-user/schema.js";

export type ReadModelDb = IRelationalDb<unknown>;

export interface CredentialDoc {
  documentId: string;
  /** The credential's issuer address, lowercased. */
  issuerAddress: string;
  /** The delegated app key (credentialSubject.id), or null when the row has none. */
  appDid: string | null;
  revoked: boolean;
}

function credentials(db: ReadModelDb) {
  return RenownCredentialProcessor.query<RenownCredentialDB>("renown-credential", db).selectFrom(
    "renown_credential",
  );
}

/**
 * Every document carrying a VC id (`credentialId`, not the document id).
 * Several can exist: copies written before writes were closed, possibly
 * claiming other issuers. Live rows come first, then the oldest.
 */
export async function findCredentialDocs(
  db: ReadModelDb,
  credentialId: string,
): Promise<CredentialDoc[]> {
  const rows = await credentials(db)
    .select(["document_id", "issuer_ethereum_address", "credential_subject_id", "revoked"])
    .where("credential_id", "=", credentialId)
    .orderBy("revoked", "asc")
    .orderBy("created_at", "asc")
    .orderBy("document_id", "asc")
    .execute();
  return rows.map((row) => ({
    documentId: row.document_id,
    issuerAddress: row.issuer_ethereum_address.toLowerCase(),
    appDid: row.credential_subject_id,
    revoked: row.revoked,
  }));
}

/**
 * The documents of every unrevoked credential `issuer` (lowercase) issued to
 * one of `appDids`: all the live delegations of those app keys, whatever
 * their VC ids. Revoking an app key revokes each of them.
 */
export async function findLiveAppKeyDocs(
  db: ReadModelDb,
  issuer: string,
  appDids: readonly string[],
): Promise<string[]> {
  if (appDids.length === 0) return [];
  const rows = await credentials(db)
    .select("document_id")
    .where((eb) => eb(eb.fn("LOWER", ["issuer_ethereum_address"]), "=", issuer))
    .where("credential_subject_id", "in", [...appDids])
    .where("revoked", "=", false)
    .orderBy("created_at", "asc")
    .orderBy("document_id", "asc")
    .execute();
  return rows.map((row) => row.document_id);
}

/**
 * The profile document for an address (case-insensitive). When there are
 * several, it is the one the profile readers (`renownUser`, OIDC userinfo)
 * return: newest `created_at`, then highest document id.
 */
export async function findNewestProfileDoc(
  db: ReadModelDb,
  address: string,
): Promise<string | undefined> {
  const row = await RenownUserProcessor.query<RenownUserDB>("renown-user", db)
    .selectFrom("renown_user")
    .select("document_id")
    .where((eb) => eb(eb.fn("LOWER", ["renown_user.eth_address"]), "=", address.toLowerCase()))
    .orderBy("renown_user.created_at", "desc")
    .orderBy("renown_user.document_id", "desc")
    .executeTakeFirst();
  return row?.document_id;
}

/**
 * The profile document holding `handle` (case-insensitive), if any. The
 * unique index on LOWER(handle) allows at most one.
 */
export async function findHandleOwner(db: ReadModelDb, handle: string): Promise<string | undefined> {
  const row = await RenownUserProcessor.query<RenownUserDB>("renown-user", db)
    .selectFrom("renown_user")
    .select("document_id")
    .where((eb) => eb(eb.fn("LOWER", ["renown_user.handle"]), "=", handle.toLowerCase()))
    .executeTakeFirst();
  return row?.document_id;
}
