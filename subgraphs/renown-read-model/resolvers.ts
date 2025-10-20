import { type Subgraph } from "@powerhousedao/reactor-api";
import { RenownUserProcessor } from "../../processors/renown-user/index.js";
import type { DB } from "../../processors/renown-user/schema.js";

interface RenownUserInput {
  driveId: string;
  phid?: string;
  ethAddress?: string;
  username?: string;
}

interface RenownUsersInput {
  driveId: string;
  phids?: string[];
  ethAddresses?: string[];
  usernames?: string[];
}

interface RenownUser {
  documentId: string;
  username: string | null;
  ethAddress: string | null;
  userImage: string | null;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
}

const mapToUser = (user: {
  document_id: string;
  username: string | null;
  eth_address: string | null;
  user_image: string | null;
  created_at: Date | null;
  updated_at: Date | null;
}): RenownUser => ({
  documentId: user.document_id,
  username: user.username,
  ethAddress: user.eth_address,
  userImage: user.user_image,
  createdAt: user.created_at,
  updatedAt: user.updated_at,
});

export const getResolvers = (subgraph: Subgraph): Record<string, unknown> => {
  const db = subgraph.relationalDb;

  return {
    Query: {
      renownUser: async (
        parent: unknown,
        args: { input: RenownUserInput }
      ): Promise<RenownUser | null> => {
        const { driveId, phid, ethAddress, username } = args.input;

        let query = RenownUserProcessor.query<DB>(driveId, db).selectFrom(
          "renown_user"
        );

        // Priority: phid > ethAddress > username
        if (phid) {
          query = query.where("renown_user.document_id", "=", phid);
        } else if (ethAddress) {
          query = query.where("renown_user.eth_address", "=", ethAddress);
        } else if (username) {
          query = query.where("renown_user.username", "=", username);
        } else {
          throw new Error(
            "At least one of phid, ethAddress, or username must be provided"
          );
        }

        const result = await query.selectAll().executeTakeFirst();

        return result ? mapToUser(result) : null;
      },

      renownUsers: async (
        parent: unknown,
        args: { input: RenownUsersInput }
      ): Promise<RenownUser[]> => {
        const { driveId, phids, ethAddresses, usernames } = args.input;

        let query = RenownUserProcessor.query<DB>(driveId, db).selectFrom(
          "renown_user"
        );

        const hasPhids = phids && phids.length > 0;
        const hasEthAddresses = ethAddresses && ethAddresses.length > 0;
        const hasUsernames = usernames && usernames.length > 0;

        if (!hasPhids && !hasEthAddresses && !hasUsernames) {
          throw new Error(
            "At least one of phids, ethAddresses, or usernames must be provided"
          );
        }

        query = query.where((eb) => {
          const conditions = [];

          if (hasPhids) {
            conditions.push(eb("renown_user.document_id", "in", phids));
          }

          if (hasEthAddresses) {
            conditions.push(eb("renown_user.eth_address", "in", ethAddresses));
          }

          if (hasUsernames) {
            conditions.push(eb("renown_user.username", "in", usernames));
          }

          return eb.or(conditions);
        });

        const results = await query.selectAll().execute();

        return results.map(mapToUser);
      },
    },
  };
};
