import type { ISubgraph } from "@powerhousedao/reactor-api";
import { type RenownUserDocument } from "../../document-models/renown-user/index.js";

export const getResolvers = (subgraph: ISubgraph): Record<string, unknown> => {
  const reactor = subgraph.reactorClient;

  return {
    Query: {
      RenownUser: async () => {
        return {
          getDocument: async (args: { docId: string; driveId: string }) => {
            const { docId, driveId } = args;

            if (!docId) {
              throw new Error("Document id is required");
            }

            if (driveId) {
              const { results: children } = await reactor.find({ parentId: driveId });
              const childIds = children.map((c) => c.header.id);
              if (!childIds.includes(docId)) {
                throw new Error(
                  `Document with id ${docId} is not part of ${driveId}`,
                );
              }
            }

            const doc = await reactor.get<RenownUserDocument>(docId);
            return {
              driveId: driveId,
              ...doc,
              ...doc.header,
              created: doc.header.createdAtUtcIso,
              lastModified: doc.header.lastModifiedAtUtcIso,
              state: doc.state.global,
              stateJSON: doc.state.global,
              revision: doc.header?.revision?.global ?? 0,
            };
          },
          getDocuments: async (args: { driveId: string }) => {
            const { driveId } = args;
            const { results: children } = await reactor.find({ parentId: driveId });
            const docs = await Promise.all(
              children.map(async (child) => {
                const doc = await reactor.get<RenownUserDocument>(
                  child.header.id,
                );
                return {
                  driveId: driveId,
                  ...doc,
                  ...doc.header,
                  created: doc.header.createdAtUtcIso,
                  lastModified: doc.header.lastModifiedAtUtcIso,
                  state: doc.state.global,
                  stateJSON: doc.state.global,
                  revision: doc.header?.revision?.global ?? 0,
                };
              }),
            );

            return docs.filter(
              (doc) => doc.header.documentType === "powerhouse/renown-user",
            );
          },
        };
      },
    },
  };
};
