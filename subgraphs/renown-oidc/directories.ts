import type { BaseSubgraph } from "@powerhousedao/reactor-api";
import { RenownUserProcessor } from "../../processors/renown-user/index.js";
import type { DB as RenownUserDB } from "../../processors/renown-user/schema.js";
import type { ClientDirectory, ProfileDirectory } from "./http/deps.js";
import type { OidcStore } from "./store/types.js";

/**
 * Clients come only from the `oidc_clients` table — never from the mirrored
 * `renown/oidc-client` documents, which anyone can edit on an open switchboard.
 */
export function createClientDirectory(store: Pick<OidcStore, "getClient">): ClientDirectory {
  return {
    async getClient(clientId) {
      try {
        return await store.getClient(clientId);
      } catch {
        return undefined;
      }
    },
  };
}

/** Profiles come from the renown-user read model, matched case-insensitively by address. */
export function createProfileDirectory(relationalDb: BaseSubgraph["relationalDb"]): ProfileDirectory {
  return {
    async getProfile(address) {
      try {
        const row = await RenownUserProcessor.query<RenownUserDB>("renown-user", relationalDb)
          .selectFrom("renown_user")
          .select(["username", "user_image"])
          .where((eb) => eb(eb.fn("LOWER", ["renown_user.eth_address"]), "=", address.toLowerCase()))
          // Newest first, so duplicate documents for one address resolve deterministically.
          .orderBy("renown_user.created_at", "desc")
          .orderBy("renown_user.document_id", "desc")
          .executeTakeFirst();
        return row ? { username: row.username, userImage: row.user_image } : undefined;
      } catch {
        return undefined;
      }
    },
  };
}
