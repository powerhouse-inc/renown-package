import { type Subgraph } from "@powerhousedao/reactor-api";
import { addFile } from "document-drive";
import {
  actions,
  type InitInput,
  type RevokeInput,
  type UpdateCredentialSubjectInput,
  type SetJwtInput,
  type SetCredentialStatusInput,
  type RenownCredentialDocument,
} from "../../document-models/renown-credential/index.js";
import { setName } from "document-model";

export const getResolvers = (subgraph: Subgraph): Record<string, unknown> => {
  const reactor = subgraph.reactor;

  return {
    Query: {
      RenownCredential: async () => {
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
                  `Document with id ${docId} is not part of ${driveId}`,
                );
              }
            }

            const doc =
              await reactor.getDocument<RenownCredentialDocument>(docId);
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
                const doc =
                  await reactor.getDocument<RenownCredentialDocument>(docId);
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
              (doc) => doc.header.documentType === "renown/credential",
            );
          },
        };
      },
    },
    Mutation: {
      RenownCredential_createDocument: async (
        _: unknown,
        args: { name: string; driveId?: string },
      ) => {
        const { driveId, name } = args;
        const document = await reactor.addDocument("renown/credential");

        if (driveId) {
          await reactor.addAction(
            driveId,
            addFile({
              name,
              id: document.header.id,
              documentType: "renown/credential",
            }),
          );
        }

        if (name) {
          await reactor.addAction(document.header.id, setName(name));
        }

        return document.header.id;
      },

      RenownCredential_init: async (
        _: unknown,
        args: { docId: string; input: InitInput },
      ) => {
        const { docId, input } = args;
        const doc = await reactor.getDocument<RenownCredentialDocument>(docId);
        if (!doc) {
          throw new Error("Document not found");
        }

        const result = await reactor.addAction(docId, actions.init(input));

        if (result.status !== "SUCCESS") {
          throw new Error(result.error?.message ?? "Failed to init");
        }

        return true;
      },

      RenownCredential_revoke: async (
        _: unknown,
        args: { docId: string; input: RevokeInput },
      ) => {
        const { docId, input } = args;
        const doc = await reactor.getDocument<RenownCredentialDocument>(docId);
        if (!doc) {
          throw new Error("Document not found");
        }

        const result = await reactor.addAction(docId, actions.revoke(input));

        if (result.status !== "SUCCESS") {
          throw new Error(result.error?.message ?? "Failed to revoke");
        }

        return true;
      },

      RenownCredential_updateCredentialSubject: async (
        _: unknown,
        args: { docId: string; input: UpdateCredentialSubjectInput },
      ) => {
        const { docId, input } = args;
        const doc = await reactor.getDocument<RenownCredentialDocument>(docId);
        if (!doc) {
          throw new Error("Document not found");
        }

        const result = await reactor.addAction(
          docId,
          actions.updateCredentialSubject(input),
        );

        if (result.status !== "SUCCESS") {
          throw new Error(
            result.error?.message ?? "Failed to updateCredentialSubject",
          );
        }

        return true;
      },

      RenownCredential_setJwt: async (
        _: unknown,
        args: { docId: string; input: SetJwtInput },
      ) => {
        const { docId, input } = args;
        const doc = await reactor.getDocument<RenownCredentialDocument>(docId);
        if (!doc) {
          throw new Error("Document not found");
        }

        const result = await reactor.addAction(docId, actions.setJwt(input));

        if (result.status !== "SUCCESS") {
          throw new Error(result.error?.message ?? "Failed to setJwt");
        }

        return true;
      },

      RenownCredential_setCredentialStatus: async (
        _: unknown,
        args: { docId: string; input: SetCredentialStatusInput },
      ) => {
        const { docId, input } = args;
        const doc = await reactor.getDocument<RenownCredentialDocument>(docId);
        if (!doc) {
          throw new Error("Document not found");
        }

        const result = await reactor.addAction(
          docId,
          actions.setCredentialStatus(input),
        );

        if (result.status !== "SUCCESS") {
          throw new Error(
            result.error?.message ?? "Failed to setCredentialStatus",
          );
        }

        return true;
      },
    },
  };
};
