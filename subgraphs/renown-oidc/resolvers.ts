import type { IReactorClient } from "@powerhousedao/reactor";
import { GraphQLError } from "graphql";
import { constantTimeEqual } from "./core/crypto.js";
import type { OidcAllowedOrg, OidcClient, OidcConfig } from "./core/types.js";
import {
  ClientRegistryError,
  registerClient,
  rotateClientSecret,
  updateClient,
  type ClientCredentials,
  type ClientRegistryDeps,
  type RegisterClientInput,
  type UpdateClientInput,
} from "./register.js";
import type { OidcStore } from "./store/types.js";
import type { OrgClientOwners } from "./http/deps.js";

export interface ResolverDeps {
  /** Read lazily: the config is resolved when the subgraph is set up. */
  config(): OidcConfig;
  /** The client registry's store; undefined until set up (or when the relational namespace is unavailable). */
  store(): OidcStore | undefined;
  reactorClient: Pick<IReactorClient, "createEmpty" | "execute">;
  /** Org ownership of clients; an org-owned client keeps its organisation restriction here. */
  orgClients?: OrgClientOwners;
  now?: () => Date;
  log?: (message: string) => void;
}

interface OidcClientInfo {
  clientId: string;
  name: string | null;
  redirectUris: string[];
  allowedOrgs: OidcAllowedOrg[];
  status: string;
}

interface ResolverContext {
  headers?: Record<string, string | string[] | undefined>;
}

/** The header carrying the registration token (Node lowercases incoming header names). */
export const REGISTRATION_TOKEN_HEADER = "x-renown-oidc-registration-token";

/**
 * True only when the registration token is configured and the request carries
 * it in `X-Renown-OIDC-Registration-Token`. A dedicated header, not
 * `Authorization`, so the host's own bearer-token auth never sees it.
 */
function isAuthorizedRegistration(registrationToken: string | null, ctx: ResolverContext): boolean {
  if (registrationToken === null) return false;
  const header = ctx.headers?.[REGISTRATION_TOKEN_HEADER];
  if (typeof header !== "string") return false;
  return constantTimeEqual(header, registrationToken);
}

function publicInfo(client: OidcClient): OidcClientInfo {
  return {
    clientId: client.id,
    name: client.name.length > 0 ? client.name : null,
    redirectUris: client.redirectUris,
    allowedOrgs: client.allowedOrgs ?? [],
    status: client.status,
  };
}

function unavailable(): GraphQLError {
  return new GraphQLError("The OIDC client registry is unavailable");
}

/** Maps registry input/lookup errors to GraphQL errors; anything else propagates unchanged. */
async function asGraphQL<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ClientRegistryError) {
      throw new GraphQLError(error.message, { extensions: { code: error.code } });
    }
    throw error;
  }
}

/**
 * An org-owned client is managed by its organisation's admins (renown-orgs):
 * this path may not widen who can sign in to it — its allowedOrgs stay
 * exactly [{orgId, MEMBER}], it never allows any subject, and it gains no
 * allowed subjects. Anything else (name, redirect URIs, status) still goes.
 */
async function keepOrgRestriction(owners: OrgClientOwners | undefined, clientId: string, input: UpdateClientInput): Promise<void> {
  const owner = await owners?.ownerOf(clientId);
  if (!owner) return;
  const managed = (message: string) =>
    new GraphQLError(`This client is owned by an organisation: ${message}`, { extensions: { code: "BAD_USER_INPUT" } });
  if (input.allowedOrgs != null) {
    const kept = input.allowedOrgs.length === 1 && input.allowedOrgs.every((org) => org.orgId.trim() === owner.orgId && org.minRole.trim().toUpperCase() === "MEMBER");
    if (!kept) {
      throw managed("allowedOrgs cannot change");
    }
  }
  if (input.allowAnySubject === true) throw managed("allowAnySubject cannot be enabled");
  if ((input.addAllowedSubjects ?? []).length > 0) throw managed("allowed subjects cannot be added");
}

export function createResolvers(deps: ResolverDeps): Record<string, unknown> {
  /** The registry, after checking the caller's registration token. */
  function authorizedRegistry(ctx: ResolverContext): ClientRegistryDeps {
    const config = deps.config();
    if (!isAuthorizedRegistration(config.registrationToken, ctx)) {
      throw new GraphQLError("Unauthorized");
    }
    const store = deps.store();
    if (!store) throw unavailable();
    return {
      store,
      reactorClient: deps.reactorClient,
      driveId: config.driveId,
      now: deps.now ?? (() => new Date()),
      log: deps.log ?? ((message) => console.warn(message)),
    };
  }

  return {
    Query: {
      oidcClient: async (_parent: unknown, args: { clientId: string }): Promise<OidcClientInfo | null> => {
        const store = deps.store();
        if (!store) throw unavailable();
        const client = await store.getClient(args.clientId);
        return client ? publicInfo(client) : null;
      },
    },
    Mutation: {
      registerOidcClient: async (
        _parent: unknown,
        args: { input: Omit<RegisterClientInput, "confidential"> & { confidential?: boolean | null } },
        ctx: ResolverContext,
      ): Promise<ClientCredentials> => {
        const registry = authorizedRegistry(ctx);
        return asGraphQL(() =>
          registerClient(registry, { ...args.input, confidential: args.input.confidential ?? true }),
        );
      },
      updateOidcClient: async (
        _parent: unknown,
        args: { clientId: string; input: UpdateClientInput },
        ctx: ResolverContext,
      ): Promise<OidcClientInfo> => {
        const registry = authorizedRegistry(ctx);
        await keepOrgRestriction(deps.orgClients, args.clientId, args.input);
        return publicInfo(await asGraphQL(() => updateClient(registry, args.clientId, args.input)));
      },
      rotateOidcClientSecret: async (
        _parent: unknown,
        args: { clientId: string; confidential?: boolean | null },
        ctx: ResolverContext,
      ): Promise<ClientCredentials> => {
        const registry = authorizedRegistry(ctx);
        const confidential = args.confidential ?? true;
        if (!confidential && (await deps.orgClients?.ownerOf(args.clientId))) {
          throw new GraphQLError("This client is owned by an organisation: it must stay confidential", { extensions: { code: "BAD_USER_INPUT" } });
        }
        return asGraphQL(() => rotateClientSecret(registry, args.clientId, confidential));
      },
    },
  };
}
