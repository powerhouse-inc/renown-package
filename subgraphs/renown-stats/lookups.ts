import { RenownCredentialProcessor } from "../../processors/renown-credential/index.js";
import type { DB as RenownCredentialDB } from "../../processors/renown-credential/schema.js";
import type { ReadModelDb } from "../renown-auth/lookups.js";

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
