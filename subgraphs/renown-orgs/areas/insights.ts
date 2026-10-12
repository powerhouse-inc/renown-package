import { getAddress } from "viem";
import { pkhDidFor } from "../../renown-stats/core/dids.js";
import { orgDid } from "../core/config.js";
import { unavailable } from "../core/errors.js";
import type { Area, OrgRuntime } from "../runtime.js";
import { activeUsersOfApps, liveCredentialsForApps, type CredentialRow } from "../store/foreign.js";
import { mapLimited } from "./credentials.js";

const DAY_MS = 86_400_000;
/** Live delegations checked against organisation rules per organizationStats call (newest first). */
export const MAX_DELEGATIONS_SCANNED = 2000;
const STATUS_CONCURRENCY = 10;

async function countingDelegations(rt: OrgRuntime, rows: readonly CredentialRow[]): Promise<number> {
  // A credential id can appear on several documents: count each once.
  const unique = [...new Map(rows.map((row) => [row.credentialId, row])).values()];
  const verdicts = await mapLimited(unique, STATUS_CONCURRENCY, (row) =>
    rt.policy().credentialStatus({ credentialId: row.credentialId, appDid: row.appDid, issuer: row.issuer, issuedAt: row.issuanceDate }),
  );
  return verdicts.filter((verdict) => verdict.counts).length;
}

/** https://<host> for a did:web host (":" is percent-encoded there). */
function siteOrigin(didHost: string): string {
  return `https://${didHost.replace(/%3A/gi, ":")}`;
}

export const insightResolvers: Area = (rt) => ({
  Query: {
    organizationStats: async (_: unknown, args: { orgId: string }) => {
      const store = rt.store();
      const org = await store.organization(args.orgId);
      if (!org || org.takenDown) return null;
      const now = rt.now();
      const since = new Date(now.getTime() - 30 * DAY_MS);
      const apps = (await store.orgApps(org.id)).map((app) => app.appDid);
      try {
        const db = rt.deps.relationalDb;
        const [activeUsers30d, live, attestations30d] = await Promise.all([
          activeUsersOfApps(db, apps, since),
          liveCredentialsForApps(db, apps, now, MAX_DELEGATIONS_SCANNED),
          store.countOrgAttestationsSince(org.id, since),
        ]);
        return { orgId: org.id, apps: apps.length, activeUsers30d, activeDelegations: await countingDelegations(rt, live), attestations30d };
      } catch (error) {
        console.error(`[renown-orgs] organizationStats ${org.id}: ${error instanceof Error ? error.message : "unknown error"}`);
        throw unavailable("Organization totals cannot be computed right now");
      }
    },
    organizationDidDocument: async (_: unknown, args: { orgId: string }) => {
      const store = rt.store();
      const org = await store.organization(args.orgId);
      if (!org || org.archived || org.takenDown) return null;
      const didHost = rt.config().didHost;
      const origin = siteOrigin(didHost);
      const did = orgDid(didHost, org.id);
      const owners = (await store.members(org.id, ["ACTIVE"])).filter((member) => member.role === "OWNER");
      // Key ids follow the owner's address, so they stay stable as owners come and go.
      const methods = owners.map((owner) => ({
        id: `${did}#owner-${owner.address}`,
        type: "EcdsaSecp256k1RecoveryMethod2020",
        controller: did,
        blockchainAccountId: `eip155:1:${getAddress(owner.address)}`,
      }));
      const domains = ((await store.verifiedDomains([org.id])).get(org.id) ?? []).map((domain) => `https://${domain}`);
      const keyIds = methods.map((method) => method.id);
      return JSON.stringify({
        "@context": ["https://www.w3.org/ns/did/v1", "https://w3id.org/security/suites/secp256k1recovery-2020/v2"],
        id: did,
        alsoKnownAs: [`${origin}/@${org.handle}`, ...domains],
        controller: owners.map((owner) => pkhDidFor(owner.address)),
        verificationMethod: methods,
        authentication: keyIds,
        assertionMethod: keyIds,
        service: [
          { id: `${did}#renown`, type: "RenownOrganization", serviceEndpoint: `${origin}/org/${org.id}` },
          ...(domains.length > 0 ? [{ id: `${did}#domains`, type: "LinkedDomains", serviceEndpoint: { origins: domains } }] : []),
        ],
      });
    },
  },
});
