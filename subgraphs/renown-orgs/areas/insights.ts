import { getAddress } from "viem";
import { pkhDidFor } from "../../renown-stats/core/dids.js";
import { mapLimited } from "../core/concurrency.js";
import { orgDid } from "../core/config.js";
import { unavailable } from "../core/errors.js";
import type { OrgContext } from "../core/auth.js";
import type { Area, OrgRuntime } from "../runtime.js";
import {
  activeUsersOfApps,
  liveCredentialsForApps,
  type CredentialRow,
} from "../store/foreign.js";

const DAY_MS = 86_400_000;
/** Live delegations checked against organisation rules per organizationStats call (newest first). */
export const MAX_DELEGATIONS_SCANNED = 2000;
const STATUS_CONCURRENCY = 10;
/** organizationStats are cached per organisation for this long (per process). */
export const STATS_TTL_MS = 60_000;
/** Organisations whose totals are cached at once; the oldest entry goes first. */
export const STATS_CACHE_SIZE = 500;

export interface OrganizationStatsOutput {
  orgId: string;
  apps: number;
  activeUsers30d: number;
  activeDelegations: number;
  attestations30d: number;
}

async function countingDelegations(
  rt: OrgRuntime,
  rows: readonly CredentialRow[],
): Promise<number> {
  // A credential id can appear on several documents: count each once.
  const unique = [
    ...new Map(rows.map((row) => [row.credentialId, row])).values(),
  ];
  const verdicts = await mapLimited(unique, STATUS_CONCURRENCY, (row) =>
    rt.policy().credentialStatus({
      credentialId: row.credentialId,
      appDid: row.appDid,
      issuer: row.issuer,
      issuedAt: row.issuanceDate,
    }),
  );
  return verdicts.filter((verdict) => verdict.counts).length;
}

/** https://<host> for a did:web host (":" is percent-encoded there). */
function siteOrigin(didHost: string): string {
  return `https://${didHost.replace(/%3A/gi, ":")}`;
}

async function computeStats(
  rt: OrgRuntime,
  orgId: string,
  now: Date,
): Promise<OrganizationStatsOutput> {
  const store = rt.store();
  const since = new Date(now.getTime() - 30 * DAY_MS);
  const apps = (await store.orgApps(orgId)).map((app) => app.appDid);
  try {
    const db = rt.deps.relationalDb;
    const [activeUsers30d, live, attestations30d] = await Promise.all([
      activeUsersOfApps(db, apps, since),
      liveCredentialsForApps(db, apps, now, MAX_DELEGATIONS_SCANNED),
      store.countOrgAttestationsSince(orgId, since),
    ]);
    return {
      orgId,
      apps: apps.length,
      activeUsers30d,
      activeDelegations: await countingDelegations(rt, live),
      attestations30d,
    };
  } catch (error) {
    console.error(
      `[renown-orgs] organizationStats ${orgId}: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    throw unavailable("Organization totals cannot be computed right now");
  }
}

export const insightResolvers: Area = (rt) => {
  /** Per-organisation totals, so repeated public reads cost one computation a minute. Insertion-ordered: the first key is the oldest. */
  const statsCache = new Map<
    string,
    { at: number; value: Promise<OrganizationStatsOutput> }
  >();
  return {
    Query: {
      organizationStats: async (
        _: unknown,
        args: { orgId: string },
        ctx: OrgContext,
      ) => {
        rt.throttleRead(ctx);
        const store = rt.store();
        const org = await store.organization(args.orgId);
        if (!org || org.takenDown) return null;
        const now = rt.now().getTime();
        const cached = statsCache.get(org.id);
        if (cached && now - cached.at < STATS_TTL_MS) return cached.value;
        statsCache.delete(org.id);
        // Concurrent callers share one computation; a failure is not cached.
        const value = computeStats(rt, org.id, new Date(now));
        statsCache.set(org.id, { at: now, value });
        value.catch(() => statsCache.delete(org.id));
        while (statsCache.size > STATS_CACHE_SIZE) {
          const oldest = statsCache.keys().next().value;
          if (oldest === undefined) break;
          statsCache.delete(oldest);
        }
        return value;
      },
      organizationDidDocument: async (_: unknown, args: { orgId: string }) => {
        const store = rt.store();
        const org = await store.organization(args.orgId);
        if (!org || org.archived || org.takenDown) return null;
        const didHost = rt.config().didHost;
        const origin = siteOrigin(didHost);
        const did = orgDid(didHost, org.id);
        const owners = (await store.members(org.id, ["ACTIVE"])).filter(
          (member) => member.role === "OWNER",
        );
        // Key ids follow the owner's address, so they stay stable as owners come and go.
        const methods = owners.map((owner) => ({
          id: `${did}#owner-${owner.address}`,
          type: "EcdsaSecp256k1RecoveryMethod2020",
          controller: did,
          blockchainAccountId: `eip155:1:${getAddress(owner.address)}`,
        }));
        const domains = (
          (await store.verifiedDomains([org.id])).get(org.id) ?? []
        ).map((domain) => `https://${domain}`);
        const keyIds = methods.map((method) => method.id);
        return JSON.stringify({
          "@context": [
            "https://www.w3.org/ns/did/v1",
            "https://w3id.org/security/suites/secp256k1recovery-2020/v2",
          ],
          id: did,
          alsoKnownAs: [`${origin}/@${org.handle}`, ...domains],
          controller: owners.map((owner) => pkhDidFor(owner.address)),
          verificationMethod: methods,
          authentication: keyIds,
          assertionMethod: keyIds,
          service: [
            {
              id: `${did}#renown`,
              type: "RenownOrganization",
              serviceEndpoint: `${origin}/org/${org.id}`,
            },
            ...(domains.length > 0
              ? [
                  {
                    id: `${did}#domains`,
                    type: "LinkedDomains",
                    serviceEndpoint: { origins: domains },
                  },
                ]
              : []),
          ],
        });
      },
    },
  };
};
