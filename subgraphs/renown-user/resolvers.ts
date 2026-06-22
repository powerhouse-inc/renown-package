import type { ISubgraph } from "@powerhousedao/reactor-api";
import {
  actions,
  type SetUsernameInput,
  type SetEthAddressInput,
  type SetUserImageInput,
  type RenownUserDocument,
} from "document-models/renown-user";
import { setName } from "document-model";

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
              const { results: children } = await reactor.find({
                parentId: driveId,
              });
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
            const { results: children } = await reactor.find({
              parentId: driveId,
            });
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
    Mutation: {
      RenownUser_createDocument: async (
        _: unknown,
        args: { name: string; driveId?: string },
      ) => {
        const { driveId, name } = args;
        const document = await reactor.createEmpty<RenownUserDocument>(
          "powerhouse/renown-user",
          driveId ? { parentIdentifier: driveId } : undefined,
        );

        if (name) {
          await reactor.execute(document.header.id, "main", [setName(name)]);
        }

        return document.header.id;
      },

      RenownUser_setUsername: async (
        _: unknown,
        args: { docId: string; input: SetUsernameInput },
      ) => {
        const { docId, input } = args;
        const doc = await reactor.get<RenownUserDocument>(docId);
        if (!doc) {
          throw new Error("Document not found");
        }

        await reactor.execute(docId, "main", [actions.setUsername(input)]);

        return true;
      },

      RenownUser_setEthAddress: async (
        _: unknown,
        args: { docId: string; input: SetEthAddressInput },
      ) => {
        const { docId, input } = args;
        const doc = await reactor.get<RenownUserDocument>(docId);
        if (!doc) {
          throw new Error("Document not found");
        }

        await reactor.execute(docId, "main", [actions.setEthAddress(input)]);

        return true;
      },

      RenownUser_setUserImage: async (
        _: unknown,
        args: { docId: string; input: SetUserImageInput },
      ) => {
        const { docId, input } = args;
        const doc = await reactor.get<RenownUserDocument>(docId);
        if (!doc) {
          throw new Error("Document not found");
        }

        await reactor.execute(docId, "main", [actions.setUserImage(input)]);

        return true;
      },
    },
  };
};
