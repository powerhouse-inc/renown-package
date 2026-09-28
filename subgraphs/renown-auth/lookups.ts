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
 * The credential document for a VC id (`credentialId`, not the document id).
 * Several documents can carry the same VC id (copies written before writes
 * were closed); a live one is preferred over a revoked one, then the oldest.
 */
export async function findCredentialDoc(
  db: ReadModelDb,
  credentialId: string,
): Promise<CredentialDoc | undefined> {
  const row = await credentials(db)
    .select(["document_id", "issuer_ethereum_address", "revoked"])
    .where("credential_id", "=", credentialId)
    .orderBy("revoked", "asc")
    .orderBy("created_at", "asc")
    .orderBy("document_id", "asc")
    .executeTakeFirst();
  if (!row) return undefined;
  return {
    documentId: row.document_id,
    issuerAddress: row.issuer_ethereum_address.toLowerCase(),
    revoked: row.revoked,
  };
}

/**
 * Every not-yet-revoked document for a VC id issued by `issuerAddress`
 * (case-insensitive). Revoking only one of several copies would leave the
 * credential verifiable through the others.
 */
export async function findLiveCredentialDocIds(
  db: ReadModelDb,
  credentialId: string,
  issuerAddress: string,
): Promise<string[]> {
  const rows = await credentials(db)
    .select("document_id")
    .where("credential_id", "=", credentialId)
    .where("revoked", "=", false)
    .where((eb) =>
      eb(eb.fn("LOWER", ["issuer_ethereum_address"]), "=", issuerAddress.toLowerCase()),
    )
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
