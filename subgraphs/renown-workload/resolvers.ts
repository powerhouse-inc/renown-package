import { GraphQLError } from "graphql";
import { constantTimeEqual } from "../renown-oidc/core/crypto.js";
import type { WorkloadConfig, WorkloadIdentity } from "./core/types.js";
import {
  deleteWorkloadIdentity,
  getWorkloadIdentity,
  registerWorkloadIdentity,
  updateWorkloadIdentity,
  WorkloadRegistryError,
  type RegisterWorkloadIdentityInput,
  type RegistryDeps,
} from "./registry.js";
import type { WorkloadStore } from "./store/types.js";

export interface ResolverDeps {
  /** Read lazily: the config is resolved when the subgraph is set up. */
  config(): WorkloadConfig;
  /** Undefined until set up (or when the relational namespace is unavailable). */
  store(): WorkloadStore | undefined;
  now?: () => Date;
}

interface ResolverContext {
  headers?: Record<string, string | string[] | undefined>;
}

/** The header carrying the registration token (Node lowercases incoming header names). */
export const REGISTRATION_TOKEN_HEADER = "x-renown-workload-registration-token";

interface WorkloadIdentityOutput extends Omit<
  WorkloadIdentity,
  "createdAt" | "updatedAt"
> {
  createdAt: string;
}

function output(identity: WorkloadIdentity): WorkloadIdentityOutput {
  const { createdAt, updatedAt: _updatedAt, ...rest } = identity;
  return { ...rest, createdAt: createdAt.toISOString() };
}

function notConfigured(what: string): GraphQLError {
  return new GraphQLError(`${what} is not configured`, {
    extensions: { code: "SERVICE_NOT_CONFIGURED" },
  });
}

/** Maps registry errors to GraphQL errors; anything else propagates unchanged. */
async function asGraphQL<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof WorkloadRegistryError) {
      throw new GraphQLError(error.message, {
        extensions: { code: error.code },
      });
    }
    throw error;
  }
}

export function createResolvers(deps: ResolverDeps): Record<string, unknown> {
  /**
   * The registry, after checking the caller's registration token (a
   * dedicated header, so the host's own bearer auth never sees it).
   */
  function authorized(ctx: ResolverContext): RegistryDeps {
    const config = deps.config();
    if (config.registrationToken === null) {
      throw notConfigured("The workload identity API");
    }
    const header = ctx.headers?.[REGISTRATION_TOKEN_HEADER];
    if (
      typeof header !== "string" ||
      !constantTimeEqual(header, config.registrationToken)
    ) {
      throw new GraphQLError("Forbidden", {
        extensions: { code: "FORBIDDEN" },
      });
    }
    const store = deps.store();
    if (!store) throw notConfigured("The workload identity store");
    return {
      store,
      encryptionKey: config.encryptionKey,
      now: deps.now ?? (() => new Date()),
    };
  }

  return {
    Query: {
      workloadIdentity: async (
        _parent: unknown,
        args: { did: string },
        ctx: ResolverContext,
      ): Promise<WorkloadIdentityOutput | null> => {
        const identity = await getWorkloadIdentity(authorized(ctx), args.did);
        return identity ? output(identity) : null;
      },
    },
    Mutation: {
      registerWorkloadIdentity: async (
        _parent: unknown,
        args: { input: RegisterWorkloadIdentityInput },
        ctx: ResolverContext,
      ): Promise<WorkloadIdentityOutput> => {
        const registry = authorized(ctx);
        const { encryptionKey } = registry;
        if (encryptionKey === null) {
          throw notConfigured("RENOWN_WORKLOAD_KEY_ENCRYPTION_KEY");
        }
        return output(
          await asGraphQL(() =>
            registerWorkloadIdentity(
              { ...registry, encryptionKey },
              args.input,
            ),
          ),
        );
      },
      updateWorkloadIdentity: async (
        _parent: unknown,
        args: {
          did: string;
          repository?: string | null;
          productionBranch?: string | null;
        },
        ctx: ResolverContext,
      ): Promise<WorkloadIdentityOutput> => {
        const registry = authorized(ctx);
        return output(
          await asGraphQL(() =>
            updateWorkloadIdentity(registry, args.did, args),
          ),
        );
      },
      deleteWorkloadIdentity: async (
        _parent: unknown,
        args: { did: string },
        ctx: ResolverContext,
      ): Promise<boolean> => deleteWorkloadIdentity(authorized(ctx), args.did),
    },
  };
}
