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

interface GetAuthorizationsInput {
  driveId: string;
  ethAddress: string;
  subject?: string;
  includeRevoked?: boolean;
}

interface RenownProfile {
  documentId: string;
  username: string | null;
  ethAddress: string | null;
  userImage: string | null;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
}

interface Authorization {
  id: string;
  jwt: string;
  issuer: string | null;
  subject: string | null;
  audience: string | null;
  payload: string | null;
  revoked: boolean;
  createdAt: Date | string | null;
  revokedAt: Date | string | null;
  user: RenownProfile;
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

      getAuthorizations: async (
        parent: unknown,
        args: { input: GetAuthorizationsInput }
      ): Promise<Authorization[]> => {
        const { driveId, ethAddress, subject, includeRevoked = true } =
          args.input;

        if (!ethAddress) {
          throw new Error("Ethereum address is required");
        }

        let query = RenownUserProcessor.query<DB>(driveId, db)
          .selectFrom("authorization")
          .innerJoin(
            "renown_user",
            "authorization.document_id",
            "renown_user.document_id"
          )
          .select([
            "authorization.id",
            "authorization.jwt",
            "authorization.issuer",
            "authorization.subject",
            "authorization.audience",
            "authorization.payload",
            "authorization.revoked",
            "authorization.created_at",
            "authorization.revoked_at",
            "renown_user.document_id as user_document_id",
            "renown_user.username",
            "renown_user.eth_address",
            "renown_user.user_image",
            "renown_user.created_at as user_created_at",
            "renown_user.updated_at as user_updated_at",
          ])
          .where("renown_user.eth_address", "=", ethAddress);

        // Filter by subject if provided
        if (subject) {
          query = query.where("authorization.subject", "=", subject);
        }

        // Filter by revoked status if specified
        if (!includeRevoked) {
          query = query.where("authorization.revoked", "=", false);
        }

        const results = await query.execute();

        return results.map((row) => ({
          id: row.id,
          jwt: row.jwt,
          issuer: row.issuer,
          subject: row.subject,
          audience: row.audience,
          payload: row.payload,
          revoked: row.revoked,
          createdAt: row.created_at,
          revokedAt: row.revoked_at,
          user: {
            documentId: row.user_document_id,
            username: row.username,
            ethAddress: row.eth_address,
            userImage: row.user_image,
            createdAt: row.user_created_at,
            updatedAt: row.user_updated_at,
          },
        }));
      },
    },
  };
};
