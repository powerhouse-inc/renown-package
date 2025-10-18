import { type Subgraph } from "@powerhousedao/reactor-api";
import { addFile } from "document-drive";
import {
  actions,
  type SetUsernameInput,
  type SetEthAddressInput,
  type SetUserImageInput,
  type AddAuthorizationInput,
  type RevokeAuthorizationInput,
  type RemoveAuthorizationInput,
  type RenownUserDocument,
} from "../../document-models/renown-user/index.js";
import { setName } from "document-model";
import { type RenownUserSubgraph } from "./index.js";

export const getResolvers = (subgraph: Subgraph): Record<string, unknown> => {
  const reactor = subgraph.reactor;
  const renownSubgraph = subgraph as RenownUserSubgraph;

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
              const docIds = await reactor.getDocuments(driveId);
              if (!docIds.includes(docId)) {
                throw new Error(
                  `Document with id ${docId} is not part of ${driveId}`
                );
              }
            }

            const doc = await reactor.getDocument<RenownUserDocument>(docId);
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
            const docsIds = await reactor.getDocuments(driveId);
            const docs = await Promise.all(
              docsIds.map(async (docId) => {
                const doc = await reactor.getDocument<RenownUserDocument>(
                  docId
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
              })
            );

            return docs.filter(
              (doc) => doc.header.documentType === "powerhouse/renown-user"
            );
          },
          getAuthorizationsByEthAddress: async (args: {
            ethAddress: string;
            subject?: string;
            includeRevoked?: boolean;
          }) => {
            const { ethAddress, subject, includeRevoked = true } = args;

            if (!ethAddress) {
              throw new Error("Ethereum address is required");
            }

            // Get the processor from the subgraph
            const processor = renownSubgraph.processor;

            if (!processor) {
              throw new Error("RenownUserProcessor not available");
            }

            // Get authorizations from processor
            let authorizations = await processor.getAuthorizationsByEthAddress(
              ethAddress,
              includeRevoked
            );

            // Filter by subject if provided
            if (subject) {
              authorizations = authorizations.filter(
                (auth) => auth.subject === subject
              );
            }

            return authorizations;
          },
        };
      },
    },
    Mutation: {
      RenownUser_createDocument: async (
        _: unknown,
        args: { name: string; driveId?: string }
      ) => {
        const { driveId, name } = args;
        const document = await reactor.addDocument("powerhouse/renown-user");

        if (driveId) {
          await reactor.addAction(
            driveId,
            addFile({
              name,
              id: document.header.id,
              documentType: "powerhouse/renown-user",
            })
          );
        }

        if (name) {
          await reactor.addAction(document.header.id, setName(name));
        }

        return document.header.id;
      },

      RenownUser_setUsername: async (
        _: unknown,
        args: { docId: string; input: SetUsernameInput }
      ) => {
        const { docId, input } = args;
        const doc = await reactor.getDocument<RenownUserDocument>(docId);
        if (!doc) {
          throw new Error("Document not found");
        }

        const result = await reactor.addAction(
          docId,
          actions.setUsername(input)
        );

        if (result.status !== "SUCCESS") {
          throw new Error(result.error?.message ?? "Failed to setUsername");
        }

        return true;
      },

      RenownUser_setEthAddress: async (
        _: unknown,
        args: { docId: string; input: SetEthAddressInput }
      ) => {
        const { docId, input } = args;
        const doc = await reactor.getDocument<RenownUserDocument>(docId);
        if (!doc) {
          throw new Error("Document not found");
        }

        const result = await reactor.addAction(
          docId,
          actions.setEthAddress(input)
        );

        if (result.status !== "SUCCESS") {
          throw new Error(result.error?.message ?? "Failed to setEthAddress");
        }

        return true;
      },

      RenownUser_setUserImage: async (
        _: unknown,
        args: { docId: string; input: SetUserImageInput }
      ) => {
        const { docId, input } = args;
        const doc = await reactor.getDocument<RenownUserDocument>(docId);
        if (!doc) {
          throw new Error("Document not found");
        }

        const result = await reactor.addAction(
          docId,
          actions.setUserImage(input)
        );

        if (result.status !== "SUCCESS") {
          throw new Error(result.error?.message ?? "Failed to setUserImage");
        }

        return true;
      },

      RenownUser_addAuthorization: async (
        _: unknown,
        args: { docId: string; input: AddAuthorizationInput }
      ) => {
        const { docId, input } = args;
        const doc = await reactor.getDocument<RenownUserDocument>(docId);
        if (!doc) {
          throw new Error("Document not found");
        }

        const result = await reactor.addAction(
          docId,
          actions.addAuthorization(input)
        );

        if (result.status !== "SUCCESS") {
          throw new Error(
            result.error?.message ?? "Failed to addAuthorization"
          );
        }

        return true;
      },

      RenownUser_revokeAuthorization: async (
        _: unknown,
        args: { docId: string; input: RevokeAuthorizationInput }
      ) => {
        const { docId, input } = args;
        const doc = await reactor.getDocument<RenownUserDocument>(docId);
        if (!doc) {
          throw new Error("Document not found");
        }

        const result = await reactor.addAction(
          docId,
          actions.revokeAuthorization(input)
        );

        if (result.status !== "SUCCESS") {
          throw new Error(
            result.error?.message ?? "Failed to revokeAuthorization"
          );
        }

        return true;
      },

      RenownUser_removeAuthorization: async (
        _: unknown,
        args: { docId: string; input: RemoveAuthorizationInput }
      ) => {
        const { docId, input } = args;
        const doc = await reactor.getDocument<RenownUserDocument>(docId);
        if (!doc) {
          throw new Error("Document not found");
        }

        const result = await reactor.addAction(
          docId,
          actions.removeAuthorization(input)
        );

        if (result.status !== "SUCCESS") {
          throw new Error(
            result.error?.message ?? "Failed to removeAuthorization"
          );
        }

        return true;
      },
    },
  };
};
