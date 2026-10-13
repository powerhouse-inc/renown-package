import type { BaseSubgraph } from "@powerhousedao/reactor-api";
import { RenownUserProcessor } from "../../processors/renown-user/index.js";
import type { DB as RenownUserDB } from "../../processors/renown-user/schema.js";
import type { ReadModelDb } from "../renown-auth/lookups.js";
import { oidcClientOwner, orgClaimsFor } from "../renown-orgs/store/lookups.js";
import type { ClientDirectory, OrgClientOwners, OrgDirectory, ProfileDirectory } from "./http/deps.js";
import type { OidcStore } from "./store/types.js";

/**
 * Clients come only from the `oidc_clients` table — never from the mirrored
 * `renown/oidc-client` documents, which anyone can edit on an open switchboard.
 * A client owned by an archived or taken-down organisation reads as DISABLED
 * (the row is untouched, so restoring the organisation restores the client).
 * Any lookup failure reads as an unknown client.
 */
export function createClientDirectory(store: Pick<OidcStore, "getClient">, owners?: OrgClientOwners): ClientDirectory {
  return {
    async getClient(clientId) {
      try {
        const client = await store.getClient(clientId);
        if (!client || !owners) return client;
        const owner = await owners.ownerOf(clientId);
        return owner && !owner.live ? { ...client, status: "DISABLED" } : client;
      } catch {
        return undefined;
      }
    },
  };
}

/** Org ownership of OIDC clients from the renown-orgs namespace (read-only). Errors propagate. */
export function createOrgClientOwners(relationalDb: BaseSubgraph["relationalDb"]): OrgClientOwners {
  return {
    ownerOf: (clientId) => oidcClientOwner(relationalDb as unknown as ReadModelDb, clientId),
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

/** Organization memberships from the renown-orgs namespace (read-only). Errors propagate: the handlers log them and fall back to no orgs. */
export function createOrgDirectory(relationalDb: BaseSubgraph["relationalDb"], didHost: string): OrgDirectory {
  return {
    orgsOf: (address) => orgClaimsFor(relationalDb as unknown as ReadModelDb, address, didHost),
  };
}
