import { type Subgraph } from "@powerhousedao/reactor-api";
import { RenownUserProcessor } from "../../processors/renown-user/index.js";
import type { DB } from "../../processors/renown-user/schema.js";

interface GetProfileInput {
  driveId: string;
  id?: string;
  username?: string;
  ethAddress?: string;
  searchInput?: string;
}

interface GetProfilesInput {
  driveId: string;
  ids?: string[];
  usernames?: string[];
  ethAddresses?: string[];
  searchString?: string;
}

interface RenownProfile {
  documentId: string;
  username: string | null;
  ethAddress: string | null;
  userImage: string | null;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
}

const mapToProfile = (user: {
  document_id: string;
  username: string | null;
  eth_address: string | null;
  user_image: string | null;
  created_at: Date | null;
  updated_at: Date | null;
}): RenownProfile => ({
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
      getProfile: async (
        parent: unknown,
        args: { input: GetProfileInput }
      ): Promise<RenownProfile | null> => {
        const { driveId, id, username, ethAddress, searchInput } = args.input;

        let query = RenownUserProcessor.query<DB>(driveId, db).selectFrom(
          "renown_user"
        );

        // Priority: id > username > ethAddress > searchInput
        if (id) {
          query = query.where("renown_user.document_id", "=", id);
        } else if (username) {
          query = query.where("renown_user.username", "=", username);
        } else if (ethAddress) {
          query = query.where("renown_user.eth_address", "=", ethAddress);
        } else if (searchInput) {
          // Search across username and eth_address
          query = query.where((eb) =>
            eb.or([
              eb("renown_user.username", "like", `%${searchInput}%`),
              eb("renown_user.eth_address", "like", `%${searchInput}%`),
            ])
          );
        } else {
          throw new Error(
            "At least one of id, username, ethAddress, or searchInput must be provided"
          );
        }

        const result = await query.selectAll().executeTakeFirst();

        return result ? mapToProfile(result) : null;
      },

      getProfiles: async (
        parent: unknown,
        args: { input: GetProfilesInput }
      ): Promise<RenownProfile[]> => {
        const { driveId, ids, usernames, ethAddresses, searchString } =
          args.input;

        let query = RenownUserProcessor.query<DB>(driveId, db).selectFrom(
          "renown_user"
        );

        // Build OR conditions based on provided inputs
        if (ids && ids.length > 0) {
          query = query.where((eb) =>
            eb.or([
              eb("renown_user.document_id", "in", ids),
              ...(usernames && usernames.length > 0
                ? [eb("renown_user.username", "in", usernames)]
                : []),
              ...(ethAddresses && ethAddresses.length > 0
                ? [eb("renown_user.eth_address", "in", ethAddresses)]
                : []),
              ...(searchString
                ? [
                    eb.or([
                      eb("renown_user.username", "like", `%${searchString}%`),
                      eb(
                        "renown_user.eth_address",
                        "like",
                        `%${searchString}%`
                      ),
                    ]),
                  ]
                : []),
            ])
          );
        } else if (usernames && usernames.length > 0) {
          query = query.where((eb) =>
            eb.or([
              eb("renown_user.username", "in", usernames),
              ...(ethAddresses && ethAddresses.length > 0
                ? [eb("renown_user.eth_address", "in", ethAddresses)]
                : []),
              ...(searchString
                ? [
                    eb.or([
                      eb("renown_user.username", "like", `%${searchString}%`),
                      eb(
                        "renown_user.eth_address",
                        "like",
                        `%${searchString}%`
                      ),
                    ]),
                  ]
                : []),
            ])
          );
        } else if (ethAddresses && ethAddresses.length > 0) {
          query = query.where((eb) =>
            eb.or([
              eb("renown_user.eth_address", "in", ethAddresses),
              ...(searchString
                ? [
                    eb.or([
                      eb("renown_user.username", "like", `%${searchString}%`),
                      eb(
                        "renown_user.eth_address",
                        "like",
                        `%${searchString}%`
                      ),
                    ]),
                  ]
                : []),
            ])
          );
        } else if (searchString) {
          query = query.where((eb) =>
            eb.or([
              eb("renown_user.username", "like", `%${searchString}%`),
              eb("renown_user.eth_address", "like", `%${searchString}%`),
            ])
          );
        } else {
          throw new Error(
            "At least one of ids, usernames, ethAddresses, or searchString must be provided"
          );
        }

        const results = await query.selectAll().execute();

        return results.map(mapToProfile);
      },
    },
  };
};
