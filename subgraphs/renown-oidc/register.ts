import type { IReactorClient } from "@powerhousedao/reactor";
import type { PHDocument } from "document-model";
import {
  addAllowedSubject,
  addRedirectUri,
  setClientInfo,
  setClientSecretHash,
} from "../../document-models/renown-oidc-client/v1/gen/client/creators.js";
import { renownOidcClientDocumentType } from "../../document-models/renown-oidc-client/v1/gen/document-type.js";
import type { RenownOidcClientDocument } from "../../document-models/renown-oidc-client/v1/gen/types.js";
import { hashSecret, randomToken } from "./core/crypto.js";
import type { OidcClient } from "./core/types.js";

export interface RegisterClientDeps {
  reactorClient: Pick<IReactorClient, "createEmpty" | "execute">;
  driveId: string | null;
}

export interface RegisterClientInput {
  name: string;
  redirectUris: string[];
  allowedSubjects: string[];
  confidential: boolean;
}

export interface RegisteredClient {
  clientId: string;
  clientSecret: string | null;
}

/**
 * Creates a `renown/oidc-client` document for a new OIDC client and returns its
 * id (the `client_id`) plus, for a confidential client, the plaintext secret.
 * Only the secret's hash is written to the document. When the reducer rejects
 * an action (e.g. a non-https redirect URI) this throws with its message; the
 * half-configured document is left in place for audit.
 */
export async function registerClient(deps: RegisterClientDeps, input: RegisterClientInput): Promise<RegisteredClient> {
  const { reactorClient, driveId } = deps;
  const clientSecret = input.confidential ? randomToken() : null;
  const hash = clientSecret === null ? null : await hashSecret(clientSecret);

  const created = await reactorClient.createEmpty<RenownOidcClientDocument>(
    renownOidcClientDocumentType,
    driveId ? { parentIdentifier: driveId } : undefined,
  );
  const clientId = created.header.id;

  const updated = await reactorClient.execute(clientId, "main", [
    setClientInfo({ name: input.name }),
    ...input.redirectUris.map((uri) => addRedirectUri({ uri })),
    ...input.allowedSubjects.map((subject) => addAllowedSubject({ subject })),
    setClientSecretHash({ hash }),
  ]);

  const failed = Object.values(updated.operations)
    .flat()
    .find((operation) => operation.error);
  if (failed?.error) {
    throw new Error(failed.error);
  }

  return { clientId, clientSecret };
}

/** Maps a `renown/oidc-client` document to an `OidcClient`; undefined for any other document type. */
export function documentToClient(doc: PHDocument): OidcClient | undefined {
  if (doc.header.documentType !== renownOidcClientDocumentType) return undefined;
  const state = (doc as RenownOidcClientDocument).state.global;
  return {
    id: doc.header.id,
    name: state.name ?? "",
    redirectUris: state.redirectUris,
    allowedSubjects: state.allowedSubjects,
    allowAnySubject: state.allowAnySubject,
    clientSecretHash: state.clientSecretHash ?? null,
    status: state.status,
  };
}
