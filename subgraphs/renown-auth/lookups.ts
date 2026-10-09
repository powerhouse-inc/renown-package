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
    .select(["document_id", "issuer_ethereum_address", "revoked"])
    .where("credential_id", "=", credentialId)
    .orderBy("revoked", "asc")
    .orderBy("created_at", "asc")
    .orderBy("document_id", "asc")
    .execute();
  return rows.map((row) => ({
    documentId: row.document_id,
    issuerAddress: row.issuer_ethereum_address.toLowerCase(),
    revoked: row.revoked,
  }));
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
