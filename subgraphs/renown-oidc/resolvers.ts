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

/** True only when the registration token is set and the request carries it as a bearer token. */
function isAuthorizedRegistration(registrationToken: string | null, ctx: ResolverContext): boolean {
  if (registrationToken === null) return false;
  const header = ctx.headers?.authorization;
  if (typeof header !== "string") return false;
  return constantTimeEqual(header, `Bearer ${registrationToken}`);
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
