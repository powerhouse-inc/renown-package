import type { IReactorClient } from "@powerhousedao/reactor";
import type { Action } from "document-model";
import {
  addAllowedSubject,
  addRedirectUri,
  removeAllowedSubject,
  removeRedirectUri,
  setAllowAnySubject,
  setClientInfo,
  setClientSecretHash,
  setStatus,
} from "../../document-models/renown-oidc-client/v1/gen/client/creators.js";
import { renownOidcClientDocumentType } from "../../document-models/renown-oidc-client/v1/gen/document-type.js";
import type { RenownOidcClientDocument } from "../../document-models/renown-oidc-client/v1/gen/types.js";
import { isValidRedirectUri, normalizeSubject } from "../../document-models/renown-oidc-client/v1/src/utils.js";
import { hashSecret, randomToken } from "./core/crypto.js";
import type { OidcClient } from "./core/types.js";
import type { OidcClientPatch, OidcStore } from "./store/types.js";

/**
 * The client registry. The `oidc_clients` table is the only source of truth
 * for sign-in; each client also has a `renown/oidc-client` document whose id
 * is the `client_id`, kept as an audit mirror. The renown switchboard's
 * access policy is open (anyone can `execute` on any document), so the
 * document is never read back for authorisation.
 */
export interface ClientRegistryDeps {
  store: Pick<OidcStore, "createClient" | "getClient" | "updateClient">;
  reactorClient: Pick<IReactorClient, "createEmpty" | "execute">;
  driveId: string | null;
  now(): Date;
  /** Receives mirror-failure messages (never secrets). */
  log(message: string): void;
}

export class ClientRegistryError extends Error {
  constructor(
    message: string,
    public code: "BAD_USER_INPUT" | "NOT_FOUND",
  ) {
    super(message);
    this.name = "ClientRegistryError";
  }
}

export interface RegisterClientInput {
  name: string;
  redirectUris: string[];
  allowedSubjects: string[];
  confidential: boolean;
}

export interface UpdateClientInput {
  name?: string | null;
  addRedirectUris?: string[] | null;
  removeRedirectUris?: string[] | null;
  addAllowedSubjects?: string[] | null;
  removeAllowedSubjects?: string[] | null;
  allowAnySubject?: boolean | null;
  status?: "ACTIVE" | "DISABLED" | null;
}

export interface ClientCredentials {
  clientId: string;
  clientSecret: string | null;
}

function validName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new ClientRegistryError("Client name must not be empty", "BAD_USER_INPUT");
  return trimmed;
}

function validRedirectUris(uris: string[]): string[] {
  for (const uri of uris) {
    if (!isValidRedirectUri(uri)) {
      throw new ClientRegistryError(`Invalid redirect URI: ${uri}`, "BAD_USER_INPUT");
    }
  }
  return [...new Set(uris)];
}

function validSubjects(subjects: string[]): string[] {
  const normalized = subjects.map((subject) => {
    try {
      return normalizeSubject(subject);
    } catch {
      throw new ClientRegistryError(`Invalid subject: ${subject}`, "BAD_USER_INPUT");
    }
  });
  return [...new Set(normalized)];
}

/** A new secret for a confidential client (plaintext returned once, hash stored), or nulls for a public one. */
async function newSecret(confidential: boolean): Promise<{ secret: string | null; hash: string | null }> {
  if (!confidential) return { secret: null, hash: null };
  const secret = randomToken();
  return { secret, hash: await hashSecret(secret) };
}

/** Applies `actions` to the client's mirror document. Never throws: the table write already succeeded. */
async function mirror(deps: ClientRegistryDeps, clientId: string, actions: Action[]): Promise<void> {
  if (actions.length === 0) return;
  try {
    const doc = await deps.reactorClient.execute(clientId, "main", actions);
    const sent = new Set(actions.map((action) => action.id));
    const failed = Object.values(doc.operations)
      .flat()
      .find((operation) => operation.error && sent.has(operation.action.id));
    if (failed?.error) deps.log(`[renown-oidc] mirror of client ${clientId} rejected an action: ${failed.error}`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    deps.log(`[renown-oidc] mirror of client ${clientId} failed: ${reason}`);
  }
}

async function existingClient(deps: ClientRegistryDeps, clientId: string): Promise<OidcClient> {
  const client = await deps.store.getClient(clientId);
  if (!client) throw new ClientRegistryError(`Unknown client: ${clientId}`, "NOT_FOUND");
  return client;
}

/**
 * Registers a client: validates the input, creates the mirror document (its
 * id becomes the `client_id`), writes the client row, then mirrors the
 * configuration onto the document. Returns the plaintext secret once.
 */
export async function registerClient(deps: ClientRegistryDeps, input: RegisterClientInput): Promise<ClientCredentials> {
  const name = validName(input.name);
  const redirectUris = validRedirectUris(input.redirectUris);
  const allowedSubjects = validSubjects(input.allowedSubjects);
  const { secret, hash } = await newSecret(input.confidential);

  const created = await deps.reactorClient.createEmpty<RenownOidcClientDocument>(
    renownOidcClientDocumentType,
    deps.driveId ? { parentIdentifier: deps.driveId } : undefined,
  );
  const clientId = created.header.id;

  await deps.store.createClient(
    { id: clientId, name, redirectUris, allowedSubjects, allowAnySubject: false, clientSecretHash: hash, status: "ACTIVE" },
    deps.now(),
  );

  await mirror(deps, clientId, [
    setClientInfo({ name }),
    ...redirectUris.map((uri) => addRedirectUri({ uri })),
    ...allowedSubjects.map((subject) => addAllowedSubject({ subject })),
    setClientSecretHash({ hash }),
  ]);

  return { clientId, clientSecret: secret };
}

/** Applies a partial update (removals before additions) and mirrors what actually changed. */
export async function updateClient(
  deps: ClientRegistryDeps,
  clientId: string,
  input: UpdateClientInput,
): Promise<OidcClient> {
  const name = input.name == null ? undefined : validName(input.name);
  const addUris = validRedirectUris(input.addRedirectUris ?? []);
  const removeUris = new Set(input.removeRedirectUris ?? []);
  const addSubjects = validSubjects(input.addAllowedSubjects ?? []);
  const removeSubjects = new Set(validSubjects(input.removeAllowedSubjects ?? []));

  const current = await existingClient(deps, clientId);
  const patch: OidcClientPatch = {};
  const actions: Action[] = [];

  if (name !== undefined && name !== current.name) {
    patch.name = name;
    actions.push(setClientInfo({ name }));
  }

  if (addUris.length > 0 || removeUris.size > 0) {
    const kept = current.redirectUris.filter((uri) => !removeUris.has(uri));
    const next = [...new Set([...kept, ...addUris])];
    patch.redirectUris = next;
    for (const uri of current.redirectUris) if (!next.includes(uri)) actions.push(removeRedirectUri({ uri }));
    for (const uri of next) if (!current.redirectUris.includes(uri)) actions.push(addRedirectUri({ uri }));
  }

  if (addSubjects.length > 0 || removeSubjects.size > 0) {
    const kept = current.allowedSubjects.filter((subject) => !removeSubjects.has(subject));
    const next = [...new Set([...kept, ...addSubjects])];
    patch.allowedSubjects = next;
    for (const subject of current.allowedSubjects) {
      if (!next.includes(subject)) actions.push(removeAllowedSubject({ subject }));
    }
    for (const subject of next) {
      if (!current.allowedSubjects.includes(subject)) actions.push(addAllowedSubject({ subject }));
    }
  }

  if (input.allowAnySubject != null && input.allowAnySubject !== current.allowAnySubject) {
    patch.allowAnySubject = input.allowAnySubject;
    actions.push(setAllowAnySubject({ allow: input.allowAnySubject }));
  }

  if (input.status != null && input.status !== current.status) {
    patch.status = input.status;
    actions.push(setStatus({ status: input.status }));
  }

  if (Object.keys(patch).length === 0) return current;
  const updated = await deps.store.updateClient(clientId, patch, deps.now());
  if (!updated) throw new ClientRegistryError(`Unknown client: ${clientId}`, "NOT_FOUND");
  await mirror(deps, clientId, actions);
  return updated;
}

/** Replaces the client's secret (or makes it public) and returns the new plaintext secret once. */
export async function rotateClientSecret(
  deps: ClientRegistryDeps,
  clientId: string,
  confidential: boolean,
): Promise<ClientCredentials> {
  await existingClient(deps, clientId);
  const { secret, hash } = await newSecret(confidential);
  const updated = await deps.store.updateClient(clientId, { clientSecretHash: hash }, deps.now());
  if (!updated) throw new ClientRegistryError(`Unknown client: ${clientId}`, "NOT_FOUND");
  await mirror(deps, clientId, [setClientSecretHash({ hash })]);
  return { clientId, clientSecret: secret };
}
