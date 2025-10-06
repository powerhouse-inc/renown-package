import { type Subgraph } from "@powerhousedao/reactor-api";
import { RenownUserProcessor } from "../../processors/renown-user/index.js";
import { type DB } from "processors/renown-user/schema.js";

export const getResolvers = (subgraph: Subgraph): Record<string, unknown> => {
  const reactor = subgraph.reactor;
  const db = subgraph.relationalDb;

  return {
    Query: {
      getProfile: async (args: { ethAddress: string; driveId: string }) => {
        const { ethAddress, driveId } = args;
        const profile = await RenownUserProcessor.query<DB>(driveId, db)
          .selectFrom("renown_user")
          .selectAll()
          .where("eth_address", "=", ethAddress)
          .executeTakeFirst();

        return {
          ...profile,
          documentId: profile?.document_id,
          ethAddress: profile?.eth_address,
          username: profile?.username,
          userImage: profile?.user_image,
          createdAt: profile?.created_at,
          updatedAt: profile?.updated_at,
        };
      },
    },
  };
};
