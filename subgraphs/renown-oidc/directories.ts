import type { IReactorClient } from "@powerhousedao/reactor";
import type { BaseSubgraph } from "@powerhousedao/reactor-api";
import { RenownUserProcessor } from "../../processors/renown-user/index.js";
import type { DB as RenownUserDB } from "../../processors/renown-user/schema.js";
import type { ClientDirectory, ProfileDirectory } from "./http/deps.js";
import { documentToClient } from "./register.js";

/** Clients are `renown/oidc-client` documents; the `client_id` is the document id. */
export function createClientDirectory(reactorClient: Pick<IReactorClient, "get">): ClientDirectory {
  return {
    async getClient(clientId) {
      try {
        return documentToClient(await reactorClient.get(clientId));
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
