import { organizationResolvers } from "./areas/organizations.js";
import { createRuntime, type Area, type OrgsResolverDeps, type Resolver } from "./runtime.js";

/** The resolver areas of renown-orgs; each later task appends its own. */
const AREAS: readonly Area[] = [organizationResolvers];

/** All renown-orgs resolvers over one runtime (one lock map, one set of rate limiters). */
export function createResolvers(deps: OrgsResolverDeps): Record<string, unknown> {
  const rt = createRuntime(deps);
  const Query: Record<string, Resolver> = {};
  const Mutation: Record<string, Resolver> = {};
  for (const area of AREAS) {
    const built = area(rt);
    for (const [target, fields] of [[Query, built.Query], [Mutation, built.Mutation]] as const) {
      for (const [name, resolver] of Object.entries(fields ?? {})) {
        if (name in target) throw new Error(`renown-orgs: ${name} is defined twice`);
        target[name] = resolver;
      }
    }
  }
  return { Query, Mutation };
}
