import { attestationResolvers } from "./areas/attestations.js";
import { credentialResolvers } from "./areas/credentials.js";
import { domainResolvers } from "./areas/domains.js";
import { insightResolvers } from "./areas/insights.js";
import { memberResolvers } from "./areas/members.js";
import { moderationResolvers } from "./areas/moderation.js";
import { notificationResolvers } from "./areas/notifications.js";
import { oidcClientResolvers } from "./areas/oidc-clients.js";
import { organizationResolvers } from "./areas/organizations.js";
import { proposalResolvers } from "./areas/proposals.js";
import { teamResolvers } from "./areas/teams.js";
import { transferResolvers } from "./areas/transfers.js";
import { webhookResolvers } from "./areas/webhooks.js";
import { workloadResolvers } from "./areas/workloads.js";
import { createRuntime, type Area, type OrgRuntime, type OrgsResolverDeps, type Resolver } from "./runtime.js";

/** The resolver areas of renown-orgs; each later task appends its own. */
const AREAS: readonly Area[] = [organizationResolvers, memberResolvers, teamResolvers, proposalResolvers, domainResolvers, workloadResolvers, credentialResolvers, transferResolvers, attestationResolvers, insightResolvers, notificationResolvers, webhookResolvers, oidcClientResolvers, moderationResolvers];

/** All renown-orgs resolvers over one runtime (shared with the sweeper: one lock map, one set of limiters). */
export function resolversFor(rt: OrgRuntime): Record<string, unknown> {
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

export function createResolvers(deps: OrgsResolverDeps): Record<string, unknown> {
  return resolversFor(createRuntime(deps));
}
