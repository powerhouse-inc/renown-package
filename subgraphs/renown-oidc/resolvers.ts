import type { IReactorClient } from "@powerhousedao/reactor";
import { GraphQLError } from "graphql";
import { constantTimeEqual } from "./core/crypto.js";
import type { OidcConfig } from "./core/types.js";
import type { ClientDirectory } from "./http/deps.js";
import { registerClient, type RegisterClientInput, type RegisteredClient } from "./register.js";

export interface ResolverDeps {
  /** Read lazily: the config is resolved when the subgraph is set up. */
  config(): OidcConfig;
  clients: ClientDirectory;
  reactorClient: Pick<IReactorClient, "createEmpty" | "execute">;
}

interface OidcClientInfo {
  clientId: string;
  name: string | null;
  redirectUris: string[];
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

export function createResolvers(deps: ResolverDeps): Record<string, unknown> {
  return {
    Query: {
      oidcClient: async (_parent: unknown, args: { clientId: string }): Promise<OidcClientInfo | null> => {
        const client = await deps.clients.getClient(args.clientId);
        if (!client) return null;
        return {
          clientId: client.id,
          name: client.name.length > 0 ? client.name : null,
          redirectUris: client.redirectUris,
          status: client.status,
        };
      },
    },
    Mutation: {
      registerOidcClient: async (
        _parent: unknown,
        args: { input: Omit<RegisterClientInput, "confidential"> & { confidential?: boolean | null } },
        ctx: ResolverContext,
      ): Promise<RegisteredClient> => {
        const config = deps.config();
        if (!isAuthorizedRegistration(config.registrationToken, ctx)) {
          throw new GraphQLError("Unauthorized");
        }
        return registerClient(
          { reactorClient: deps.reactorClient, driveId: config.driveId },
          { ...args.input, confidential: args.input.confidential ?? true },
        );
      },
    },
  };
}
