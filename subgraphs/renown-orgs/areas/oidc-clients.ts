import type { OidcClient } from "../../renown-oidc/core/types.js";
import {
  ClientRegistryError,
  registerClient,
  rotateClientSecret,
  updateClient,
  type ClientRegistryDeps,
} from "../../renown-oidc/register.js";
import type { OrgArgs, OrgContext } from "../core/auth.js";
import { requireOrg, requireRole } from "../core/authz.js";
import { badInput, limitReached, notFound } from "../core/errors.js";
import { iso } from "../output.js";
import type { Area, OrgRuntime } from "../runtime.js";
import type { OrgOidcClientLink } from "../store/types.js";

/**
 * Org-owned OIDC clients (spec §3.8). The client itself lives in renown-oidc
 * (its `oidc_clients` row is the source of truth, its `renown/oidc-client`
 * document the audit mirror, both written by renown-oidc's own registry, so
 * names and redirect URIs are validated exactly as the generic registration
 * does); `org_oidc_clients` records which organisation owns it. The client is
 * confidential and restricted to the organisation's active members:
 * allowedOrgs [{orgId, MEMBER}], no allowed subjects, never any subject.
 * Secrets are returned once and never audited or logged. No webhook event
 * fits these changes, so none is sent.
 */

type ClientStatus = "ACTIVE" | "DISABLED";

/** Per organisation, disabled clients included. */
export const MAX_ORG_OIDC_CLIENTS = 20;

async function registry(rt: OrgRuntime): Promise<ClientRegistryDeps> {
  const oidc = await rt.oidc();
  return {
    store: oidc.store,
    reactorClient: rt.deps.reactorClient,
    driveId: oidc.driveId,
    now: () => rt.now(),
    // Mirror failures only; they never carry secrets.
    log: (message) => console.warn(message),
  };
}

/** Registry input and lookup errors as renown-orgs errors. */
async function viaRegistry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ClientRegistryError) {
      if (error.code === "NOT_FOUND") throw notFound("OIDC client");
      throw badInput(error.field ?? "input", error.message);
    }
    throw error;
  }
}

/**
 * Never includes the secret (or its hash). `live` false (archived or taken
 * down) reports DISABLED: such clients cannot authenticate whatever is stored.
 */
function clientOutput(client: OidcClient, link: OrgOidcClientLink, live: boolean) {
  return {
    clientId: client.id,
    orgId: link.orgId,
    name: client.name,
    redirectUris: [...client.redirectUris],
    status: live ? client.status : "DISABLED",
    createdAt: iso(link.createdAt),
  };
}

/** The organisation's own client for an ADMIN caller of a writable organisation, or NOT_FOUND / FORBIDDEN. */
async function ownClient(rt: OrgRuntime, orgId: string, caller: string, clientId: string): Promise<OrgOidcClientLink> {
  const store = rt.store();
  await requireOrg(store, orgId);
  await requireRole(store, orgId, caller, "ADMIN");
  const link = (await store.orgOidcClients(orgId)).find((entry) => entry.clientId === clientId);
  if (!link) throw notFound("OIDC client");
  return link;
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

export const oidcClientResolvers: Area = (rt) => ({
  Query: {
    orgOidcClients: async (_: unknown, args: OrgArgs & { orgId: string }, ctx: OrgContext) => {
      const caller = await rt.caller(ctx, "orgOidcClients", args);
      const store = rt.store();
      const org = await requireOrg(store, args.orgId, { writable: false });
      await requireRole(store, args.orgId, caller, "ADMIN");
      const live = !org.archived && !org.takenDown;
      const links = await store.orgOidcClients(args.orgId);
      if (links.length === 0) return [];
      const oidc = (await rt.oidc()).store;
      const out = [];
      for (const link of links) {
        const client = await oidc.getClient(link.clientId);
        if (client) out.push(clientOutput(client, link, live));
      }
      return out;
    },
  },
  Mutation: {
    registerOrgOidcClient: async (_: unknown, args: OrgArgs & { orgId: string; name: string; redirectUris: string[] }, ctx: OrgContext) => {
      const caller = await rt.writer(ctx, "registerOrgOidcClient", args);
      return rt.lock(`org:${args.orgId}`, async () => {
        const store = rt.store();
        const now = rt.now();
        await requireOrg(store, args.orgId);
        await requireRole(store, args.orgId, caller, "ADMIN");
        if ((await store.orgOidcClients(args.orgId)).length >= MAX_ORG_OIDC_CLIENTS) {
          throw limitReached(`At most ${MAX_ORG_OIDC_CLIENTS} OIDC clients per organisation`);
        }
        const deps = await registry(rt);
        const credentials = await viaRegistry(() =>
          registerClient(deps, {
            name: args.name,
            redirectUris: args.redirectUris,
            allowedSubjects: [],
            confidential: true,
            allowedOrgs: [{ orgId: args.orgId, minRole: "MEMBER" }],
          }),
        );
        const link: OrgOidcClientLink = { clientId: credentials.clientId, orgId: args.orgId, createdBy: caller, createdAt: now };
        try {
          await store.insertOrgOidcClient(link);
        } catch (error) {
          // Compensate: a client nobody can manage must not stay usable.
          await updateClient(deps, credentials.clientId, { status: "DISABLED" }).catch((cleanup: unknown) => {
            console.error(`[renown-orgs] registerOrgOidcClient: disabling ${credentials.clientId} failed: ${reason(cleanup)}`);
          });
          throw error;
        }
        // The client exists and is owned: from here on the secret must reach the caller (it is shown only once).
        try {
          const client = await deps.store.getClient(credentials.clientId);
          await rt.record({
            orgId: args.orgId,
            actor: caller,
            action: "registerOrgOidcClient",
            at: now,
            details: { clientId: credentials.clientId, name: client?.name ?? args.name.trim(), redirectUris: client?.redirectUris ?? args.redirectUris },
          });
        } catch (error) {
          console.error(`[renown-orgs] registerOrgOidcClient: audit of ${credentials.clientId} failed: ${reason(error)}`);
        }
        return { clientId: credentials.clientId, clientSecret: credentials.clientSecret ?? "" };
      });
    },
    updateOrgOidcClient: async (
      _: unknown,
      args: OrgArgs & {
        orgId: string;
        clientId: string;
        name?: string | null;
        addRedirectUris?: string[] | null;
        removeRedirectUris?: string[] | null;
        status?: ClientStatus | null;
      },
      ctx: OrgContext,
    ) => {
      const caller = await rt.writer(ctx, "updateOrgOidcClient", args);
      return rt.lock(`org:${args.orgId}`, async () => {
        const link = await ownClient(rt, args.orgId, caller, args.clientId);
        const deps = await registry(rt);
        // Only these fields: the organisation restriction is never touched here.
        const client = await viaRegistry(() =>
          updateClient(deps, args.clientId, {
            name: args.name,
            addRedirectUris: args.addRedirectUris,
            removeRedirectUris: args.removeRedirectUris,
            status: args.status,
          }),
        );
        await rt.record({
          orgId: args.orgId,
          actor: caller,
          action: "updateOrgOidcClient",
          at: rt.now(),
          details: {
            clientId: args.clientId,
            ...(args.name != null && { name: client.name }),
            ...(args.addRedirectUris != null && { addRedirectUris: args.addRedirectUris }),
            ...(args.removeRedirectUris != null && { removeRedirectUris: args.removeRedirectUris }),
            ...(args.status != null && { status: args.status }),
          },
        });
        // ownClient required a writable (so live) organisation.
        return clientOutput(client, link, true);
      });
    },
    rotateOrgOidcClientSecret: async (_: unknown, args: OrgArgs & { orgId: string; clientId: string }, ctx: OrgContext) => {
      const caller = await rt.writer(ctx, "rotateOrgOidcClientSecret", args);
      return rt.lock(`org:${args.orgId}`, async () => {
        await ownClient(rt, args.orgId, caller, args.clientId);
        const credentials = await viaRegistry(async () => rotateClientSecret(await registry(rt), args.clientId, true));
        await rt.record({ orgId: args.orgId, actor: caller, action: "rotateOrgOidcClientSecret", at: rt.now(), details: { clientId: args.clientId } });
        return { clientId: credentials.clientId, clientSecret: credentials.clientSecret ?? "" };
      });
    },
  },
});
