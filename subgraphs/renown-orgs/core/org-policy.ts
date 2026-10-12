import type { IRelationalDb } from "@powerhousedao/reactor-browser";
import { effectiveAllScope } from "../../../document-models/renown-organization/index.js";
import { generateId } from "document-model";
import { roleAtLeast } from "../../../sdk/orgs.js";
import type { ReadModelDb } from "../../renown-auth/lookups.js";
import { memoizedNamespace } from "../store/foreign.js";
import { jsonValue } from "../store/kysely.js";
import { isMissingNamespace } from "../store/lookups.js";
import { ORGS_NAMESPACE, type OrgRole, type OrgsDB } from "../store/types.js";
import { orgDid } from "./config.js";

const ORG_DID_RE = /^did:web:[^:]+:org:([A-Za-z0-9_-]{1,128})$/;

export interface OrgAppInfo {
  orgId: string;
  frozen: boolean;
}

export interface OrgPublisherSummary {
  id: string;
  did: string;
  handle: string;
  name: string;
  verifiedDomains: string[];
}

export type OrgCredentialReason = "ISSUER_NOT_MEMBER" | "ISSUER_NOT_PUBLISHER" | "SUSPENDED" | "APP_FROZEN";

export interface CredentialVerdict {
  /** The organisation owning the delegated app, or null for person-owned apps. */
  orgId: string | null;
  counts: boolean;
  reason: OrgCredentialReason | null;
}

/** How other subgraphs see organisations. Never throws for a missing namespace (no organisations). */
export interface OrgPolicy {
  /** The organisation owning `appDid` and whether it froze it; null for person-owned apps. */
  orgOfApp(appDid: string): Promise<OrgAppInfo | null>;
  /** The ACTIVE role of `address` in a live (not archived, not taken down) organisation, else null. */
  activeRole(orgId: string, address: string): Promise<OrgRole | null>;
  /**
   * ACTIVE PUBLISHER+ in a live organisation whose own or team scope covers
   * `appDid` (ALL for owners and admins, see effectiveAllScope). Unlike
   * hasAppCapability it does not require the app to belong to the org yet:
   * callers use it before attaching one.
   */
  coversApp(orgId: string, address: string, appDid: string): Promise<boolean>;
  /**
   * Whether a delegation by `issuer` for `appDid` counts under organisation
   * rules (spec 3.7). Person apps always do. For an org app (org_apps) the
   * reasons, in precedence order: APP_FROZEN, SUSPENDED (by that org),
   * ISSUER_NOT_MEMBER (no ACTIVE membership in a live org), ISSUER_NOT_PUBLISHER
   * (coversApp fails). Throws when organisation data cannot be read (other
   * than no organisations at all): callers fail closed.
   */
  credentialStatus(input: { credentialId: string; appDid: string; issuer: string }): Promise<CredentialVerdict>;
  /** Public card of a live organisation, null when unknown or taken down. */
  orgSummary(orgId: string): Promise<OrgPublisherSummary | null>;
  /** orgOfApp for many apps in one query; apps without an organisation are absent. */
  orgsOfApps(appDids: readonly string[]): Promise<Map<string, OrgAppInfo>>;
  /** orgSummary for many organisations in two queries; unknown or taken-down ones are absent. */
  orgSummaries(orgIds: readonly string[]): Promise<Map<string, OrgPublisherSummary>>;
  /** The organisation id of an org DID on this host (didHost); null for any other DID or host. */
  orgIdOfDid(did: string): string | null;
  orgDid(orgId: string): string;
  /** Records `appDid` as an app of `orgId` (with an audit row by `actor`); false when it already belongs to an organisation. */
  attachApp(orgId: string, appDid: string, actor: string, at: Date): Promise<boolean>;
  /** Undoes an attachApp of this caller: removes `appDid` from `orgId` (with an audit row); false when it was not there. */
  detachApp(orgId: string, appDid: string, actor: string, at: Date): Promise<boolean>;
}

/** The organisation id in did:web:<host>:org:<id>, or null. */
export function parseOrgDid(did: string): string | null {
  return ORG_DID_RE.exec(did.trim())?.[1] ?? null;
}

function stringList(value: unknown): string[] {
  const list = jsonValue<unknown>(value, []);
  return Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : [];
}

async function orEmpty<T>(fallback: T, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (isMissingNamespace(error)) return fallback;
    throw error;
  }
}

const orgsHandles = new WeakMap<ReadModelDb, Promise<IRelationalDb<OrgsDB>>>();

export function createOrgPolicy(db: ReadModelDb, didHost: string): OrgPolicy {
  /** Reads: queryNamespace is read-only on the host. */
  const orgs = () => db.queryNamespace<OrgsDB>(ORGS_NAMESPACE);
  /** Writes: a createNamespace handle, opened once. */
  const writable = () => memoizedNamespace(orgsHandles, db, () => db.createNamespace<OrgsDB>(ORGS_NAMESPACE));

  async function activeMember(orgId: string, address: string) {
    return orgs()
      .selectFrom("org_members")
      .innerJoin("organizations", "organizations.id", "org_members.org_id")
      .select(["org_members.id", "org_members.role", "org_members.app_scope_all", "org_members.app_dids"])
      .where("org_members.org_id", "=", orgId)
      .where("org_members.address", "=", address.toLowerCase())
      .where("org_members.status", "=", "ACTIVE")
      .where("organizations.archived", "=", false)
      .where("organizations.taken_down", "=", false)
      .executeTakeFirst();
  }

  /** ACTIVE PUBLISHER+ whose own (effectiveAllScope or explicit) or team scope covers `appDid`. */
  async function covers(orgId: string, address: string, appDid: string): Promise<boolean> {
    const member = await activeMember(orgId, address);
    if (!member || !roleAtLeast(member.role, "PUBLISHER")) return false;
    if (effectiveAllScope({ role: member.role, appScope: { all: member.app_scope_all } })) return true;
    if (stringList(member.app_dids).includes(appDid)) return true;
    const teams = await orgs()
      .selectFrom("org_team_members")
      .innerJoin("org_teams", "org_teams.id", "org_team_members.team_id")
      .select("org_teams.app_dids")
      .where("org_team_members.member_id", "=", member.id)
      .execute();
    return teams.some((team) => stringList(team.app_dids).includes(appDid));
  }

  function summaries(orgIds: readonly string[]): Promise<Map<string, OrgPublisherSummary>> {
    return orEmpty(new Map<string, OrgPublisherSummary>(), async () => {
      const out = new Map<string, OrgPublisherSummary>();
      const ids = [...new Set(orgIds)];
      if (ids.length === 0) return out;
      const rows = await orgs()
        .selectFrom("organizations")
        .select(["id", "handle", "name"])
        .where("id", "in", ids)
        .where("taken_down", "=", false)
        .execute();
      if (rows.length === 0) return out;
      const domains = await orgs()
        .selectFrom("org_domains")
        .select(["org_id", "domain"])
        .where(
          "org_id",
          "in",
          rows.map((row) => row.id),
        )
        .where("status", "=", "VERIFIED")
        .orderBy("domain")
        .execute();
      for (const row of rows) {
        out.set(row.id, {
          id: row.id,
          did: orgDid(didHost, row.id),
          handle: row.handle,
          name: row.name,
          verifiedDomains: domains.filter((d) => d.org_id === row.id).map((d) => d.domain),
        });
      }
      return out;
    });
  }

  return {
    orgOfApp: (appDid) =>
      orEmpty(null, async () => {
        const row = await orgs().selectFrom("org_apps").select(["org_id", "frozen"]).where("app_did", "=", appDid).executeTakeFirst();
        return row ? { orgId: row.org_id, frozen: row.frozen } : null;
      }),
    activeRole: (orgId, address) => orEmpty(null, async () => (await activeMember(orgId, address))?.role ?? null),
    coversApp: (orgId, address, appDid) => orEmpty(false, () => covers(orgId, address, appDid)),
    credentialStatus: ({ credentialId, appDid, issuer }) =>
      orEmpty<CredentialVerdict>({ orgId: null, counts: true, reason: null }, async () => {
        const app = await orgs().selectFrom("org_apps").select(["org_id", "frozen"]).where("app_did", "=", appDid).executeTakeFirst();
        if (!app) return { orgId: null, counts: true, reason: null };
        const verdict = (reason: OrgCredentialReason | null): CredentialVerdict => ({ orgId: app.org_id, counts: reason === null, reason });
        if (app.frozen) return verdict("APP_FROZEN");
        const suspended = await orgs()
          .selectFrom("org_credential_suspensions")
          .select("credential_id")
          .where("org_id", "=", app.org_id)
          .where("credential_id", "=", credentialId)
          .executeTakeFirst();
        if (suspended) return verdict("SUSPENDED");
        if (!(await activeMember(app.org_id, issuer))) return verdict("ISSUER_NOT_MEMBER");
        return verdict((await covers(app.org_id, issuer, appDid)) ? null : "ISSUER_NOT_PUBLISHER");
      }),
    orgSummary: async (orgId) => (await summaries([orgId])).get(orgId) ?? null,
    orgsOfApps: (appDids) =>
      orEmpty(new Map<string, OrgAppInfo>(), async () => {
        if (appDids.length === 0) return new Map<string, OrgAppInfo>();
        const rows = await orgs().selectFrom("org_apps").select(["app_did", "org_id", "frozen"]).where("app_did", "in", [...appDids]).execute();
        return new Map(rows.map((row) => [row.app_did, { orgId: row.org_id, frozen: row.frozen }]));
      }),
    orgSummaries: summaries,
    orgIdOfDid: (did) => {
      const id = parseOrgDid(did);
      return id !== null && did.trim() === orgDid(didHost, id) ? id : null;
    },
    orgDid: (orgId) => orgDid(didHost, orgId),
    attachApp: (orgId, appDid, actor, at) =>
      orEmpty(false, async () => {
        return (await writable()).transaction().execute(async (trx) => {
          const inserted = await trx
            .insertInto("org_apps")
            .values({ app_did: appDid, org_id: orgId, frozen: false, added_at: at })
            .onConflict((oc) => oc.column("app_did").doNothing())
            .returning("app_did")
            .executeTakeFirst();
          if (!inserted) return false;
          await trx
            .insertInto("org_audit")
            .values({ id: generateId(), org_id: orgId, at, actor, action: "attachApp", details: JSON.stringify({ appDid }) })
            .execute();
          return true;
        });
      }),
    detachApp: (orgId, appDid, actor, at) =>
      orEmpty(false, async () => {
        return (await writable()).transaction().execute(async (trx) => {
          const removed = await trx
            .deleteFrom("org_apps")
            .where("app_did", "=", appDid)
            .where("org_id", "=", orgId)
            .returning("app_did")
            .executeTakeFirst();
          if (!removed) return false;
          await trx
            .insertInto("org_audit")
            .values({ id: generateId(), org_id: orgId, at, actor, action: "detachApp", details: JSON.stringify({ appDid }) })
            .execute();
          return true;
        });
      }),
  };
}
