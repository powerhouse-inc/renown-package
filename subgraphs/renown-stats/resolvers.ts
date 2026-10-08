import type { IReactorClient } from "@powerhousedao/reactor";
import { verifyAuthBearerToken } from "@renown/sdk";
import { generateId, type Action, type PHDocument } from "document-model";
import { GraphQLError } from "graphql";
import {
  actions as profileActions,
  isLogo,
  isWebsite,
  renownAppProfileDocumentType,
  type RenownAppProfileDocument,
} from "../../document-models/renown-app-profile/index.js";
import {
  actions as statsActions,
  isMetricName,
  renownUserStatsDocumentType,
  type RenownUserStatsDocument,
} from "../../document-models/renown-user-stats/index.js";
import { createRateLimiter } from "../renown-auth/core/rate-limit.js";
import type { ReadModelDb } from "../renown-auth/lookups.js";
import {
  addressOf,
  canonicalAppDid,
  canonicalUserDid,
  pkhDidFor,
} from "./core/dids.js";
import { createKeyedLock } from "./core/keyed-lock.js";
import { hasDelegation, workloadOwner } from "./lookups.js";
import type { AppProfileEntry, StatsIndex } from "./store/types.js";

/** Carries an app token whose `aud` is the stats audience (the host would 401 it as a bearer). */
export const APP_TOKEN_HEADER = "x-renown-app-token";

const REPORT_LIMIT = 600; // per app DID per minute
const PROFILE_LIMIT = 30; // per wallet per minute
const WINDOW_MS = 60_000;
const MAX_LENGTH = {
  name: 120,
  tagline: 280,
  website: 2048,
  logo: 524_288,
} as const;

type RateLimiter = { take(key: string, now?: number): boolean };

interface ResolverContext {
  /** Set by the host when it resolved a bearer: the wallet, and the DID that signed the bearer. */
  user?: { address?: string; appKey?: string };
  headers?: Record<string, string | string[] | undefined>;
}

export interface StatsResolverDeps {
  reactorClient: Pick<IReactorClient, "createEmpty" | "execute" | "get">;
  relationalDb: ReadModelDb;
  /** Undefined until set up, or when the relational namespace is unavailable. */
  index(): StatsIndex | undefined;
  audience(): string;
  now?: () => Date;
  reportRateLimiter?: RateLimiter;
  profileRateLimiter?: RateLimiter;
}

interface ReportUserStatArgs {
  appDid: string;
  userDid: string;
  metric: string;
  value: number;
}

interface ProfileFields {
  name?: string | null;
  tagline?: string | null;
  logo?: string | null;
  website?: string | null;
}

interface UpsertAppProfileArgs extends ProfileFields {
  appDid: string;
}

interface UserStatOutput {
  appDid: string;
  metric: string;
  value: number;
  updatedAt: string;
}

interface AppProfileOutput {
  appDid: string;
  name: string | null;
  tagline: string | null;
  logo: string | null;
  website: string | null;
  publisherDid: string | null;
}

const forbidden = () =>
  new GraphQLError("Forbidden", { extensions: { code: "FORBIDDEN" } });
const invalidRequest = (message: string) =>
  new GraphQLError(message, { extensions: { code: "BAD_USER_INPUT" } });
const rateLimited = () =>
  new GraphQLError("Rate limited", { extensions: { code: "RATE_LIMITED" } });
const notConfigured = () =>
  new GraphQLError("renown-stats is not available", {
    extensions: { code: "SERVICE_NOT_CONFIGURED" },
  });

/** Rejects oversized or unsafe profile fields before anything is written ("" means clear). */
function assertProfileFields(fields: ProfileFields): void {
  for (const key of ["name", "tagline", "website", "logo"] as const) {
    const value = fields[key];
    if (value != null && value.length > MAX_LENGTH[key]) {
      throw invalidRequest(`${key} exceeds ${MAX_LENGTH[key]} characters`);
    }
  }
  const website = fields.website?.trim();
  if (website && !isWebsite(website))
    throw invalidRequest("website must be an http(s) URL");
  const logo = fields.logo?.trim();
  if (logo && !isLogo(logo))
    throw invalidRequest(
      "logo must be an https URL or a base64 image data URL",
    );
}

export function createResolvers(
  deps: StatsResolverDeps,
): Record<string, unknown> {
  const { reactorClient, relationalDb } = deps;
  const now = deps.now ?? (() => new Date());
  const reportRateLimiter =
    deps.reportRateLimiter ?? createRateLimiter(REPORT_LIMIT, WINDOW_MS);
  const profileRateLimiter =
    deps.profileRateLimiter ?? createRateLimiter(PROFILE_LIMIT, WINDOW_MS);
  const lock = createKeyedLock();

  function requireIndex(): StatsIndex {
    const index = deps.index();
    if (!index) throw notConfigured();
    return index;
  }

  /** Applies `actions`; a rejected operation becomes BAD_USER_INPUT with the reducer's message. */
  async function execute(documentId: string, actions: Action[]): Promise<void> {
    const document: PHDocument = await reactorClient.execute(
      documentId,
      "main",
      actions,
    );
    const sent = new Set(actions.map((action) => action.id));
    const failed = Object.values(document.operations)
      .flat()
      .find((operation) => operation.error && sent.has(operation.action.id));
    if (failed?.error)
      throw invalidRequest(`${failed.action.type} failed: ${failed.error}`);
  }

  /** Server-side only: the client always sees the same FORBIDDEN. */
  function warn(what: string, error: unknown): void {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[renown-stats] ${what} failed (${reason}); refusing`);
  }

  /** The lowercase owner of the registered workload identity `appDid`; undefined if none or on error. */
  async function ownerOf(appDid: string): Promise<string | undefined> {
    try {
      return await workloadOwner(relationalDb, appDid);
    } catch (error) {
      warn("workload identity lookup", error);
      return undefined;
    }
  }

  /**
   * True when `address` may act as `appDid`: `appDid` is a registered workload
   * identity owned by `address`, and `address` holds a live delegation to it.
   * A delegation alone proves nothing (anyone can self-publish one to any
   * did:key). Never throws.
   */
  async function actsFor(address: string, appDid: string): Promise<boolean> {
    const owner = await ownerOf(appDid);
    if (owner === undefined || owner !== address.toLowerCase()) return false;
    try {
      return await hasDelegation(relationalDb, address, appDid, now());
    } catch (error) {
      warn("delegation lookup", error);
      return false;
    }
  }

  /** The app DID and wallet a header app token claims, or undefined. Never throws. */
  async function appTokenCaller(
    token: string,
  ): Promise<{ appDid: string; address: string } | undefined> {
    try {
      const audience = deps.audience();
      const verified = await verifyAuthBearerToken(token, { audience });
      if (!verified) return undefined;
      // did-jwt only checks `aud` when the token has one; we require it.
      const aud = verified.payload.aud;
      if (!(Array.isArray(aud) ? aud.includes(audience) : aud === audience))
        return undefined;
      const appDid = canonicalAppDid(verified.issuer);
      const address = addressOf(
        verified.verifiableCredential.credentialSubject.address,
      );
      if (appDid === null || address === null) return undefined;
      return { appDid, address };
    } catch (error) {
      // A malformed or invalid token is the caller's problem, and anyone can
      // send one: debug only, so unauthenticated callers cannot flood the
      // logs. Real lookup outages still warn (see `warn` above).
      const reason = error instanceof Error ? error.message : String(error);
      console.debug(
        `[renown-stats] app token verification failed (${reason}); refusing`,
      );
      return undefined;
    }
  }

  /**
   * The app DID and wallet the caller presents: the header token whenever the
   * header is present at all (an empty, repeated or invalid header proves
   * nothing and never falls back), else the host bearer's signer and wallet.
   */
  async function presentedCaller(
    ctx: ResolverContext,
  ): Promise<{ appDid: string; address: string } | undefined> {
    const header = ctx.headers?.[APP_TOKEN_HEADER];
    if (header === undefined) {
      const appDid = ctx.user?.appKey;
      const address = ctx.user?.address ? addressOf(ctx.user.address) : null;
      return appDid && address ? { appDid, address } : undefined;
    }
    if (typeof header !== "string") return undefined;
    const token = header.trim().replace(/^Bearer\s+/i, "");
    return token === "" ? undefined : appTokenCaller(token);
  }

  /** True when the caller proves it is `appDid`, acting for that identity's owner. */
  async function provesApp(
    ctx: ResolverContext,
    appDid: string,
  ): Promise<boolean> {
    const caller = await presentedCaller(ctx);
    if (caller?.appDid !== appDid) return false;
    return actsFor(caller.address, appDid);
  }

  /** The user's stats document, created (and bound to the user) on first use. */
  async function userStatsDocument(
    index: StatsIndex,
    userDid: string,
  ): Promise<string> {
    const existing = await index.userStatsDocument(userDid);
    if (existing) return existing;
    const created = (
      await reactorClient.createEmpty(renownUserStatsDocumentType)
    ).header.id;
    // Bind before claiming: a claimed document always has its user DID.
    await execute(created, [statsActions.setUserDid({ userDid })]);
    return index.claimUserStatsDocument(userDid, created, now());
  }

  async function profileOutput(
    entry: AppProfileEntry,
  ): Promise<AppProfileOutput> {
    const doc = await reactorClient.get<RenownAppProfileDocument>(
      entry.documentId,
    );
    const { name, tagline, logo, website, publisherDid } = doc.state.global;
    return {
      appDid: entry.appDid,
      name: name ?? null,
      tagline: tagline ?? null,
      logo: logo ?? null,
      website: website ?? null,
      publisherDid: publisherDid ?? null,
    };
  }

  return {
    Query: {
      userStats: async (
        _: unknown,
        args: { userDid: string },
      ): Promise<UserStatOutput[]> => {
        const userDid = canonicalUserDid(args.userDid);
        if (userDid === null)
          throw invalidRequest(
            "userDid must be a did:pkh:eip155 or did:key DID",
          );
        const documentId = await requireIndex().userStatsDocument(userDid);
        if (!documentId) return [];
        const doc =
          await reactorClient.get<RenownUserStatsDocument>(documentId);
        return doc.state.global.stats.map(
          ({ appDid, metric, value, updatedAt }) => ({
            appDid,
            metric,
            value,
            updatedAt,
          }),
        );
      },

      appProfile: async (
        _: unknown,
        args: { appDid: string },
      ): Promise<AppProfileOutput | null> => {
        const appDid = canonicalAppDid(args.appDid);
        if (appDid === null)
          throw invalidRequest("appDid must be a did:key DID");
        const entry = await requireIndex().appProfile(appDid);
        return entry ? profileOutput(entry) : null;
      },

      appProfilesByPublisher: async (
        _: unknown,
        args: { publisherDid: string },
      ): Promise<AppProfileOutput[]> => {
        const address = addressOf(args.publisherDid);
        if (address === null)
          throw invalidRequest(
            "publisherDid must be a did:pkh:eip155 DID or an address",
          );
        const entries = await requireIndex().appProfilesByPublisher(address);
        return Promise.all(entries.map(profileOutput));
      },
    },

    Mutation: {
      reportUserStat: async (
        _: unknown,
        args: ReportUserStatArgs,
        ctx: ResolverContext,
      ): Promise<boolean> => {
        const appDid = canonicalAppDid(args.appDid);
        if (appDid === null)
          throw invalidRequest("appDid must be a did:key DID");
        if (!(await provesApp(ctx, appDid))) throw forbidden();

        const userDid = canonicalUserDid(args.userDid);
        if (userDid === null)
          throw invalidRequest(
            "userDid must be a did:pkh:eip155 or did:key DID",
          );
        if (!isMetricName(args.metric))
          throw invalidRequest(
            "metric must match ^[A-Za-z][A-Za-z0-9_.:-]{0,63}$",
          );
        if (!Number.isFinite(args.value))
          throw invalidRequest("value must be a finite number");
        const index = requireIndex();
        if (!reportRateLimiter.take(appDid, now().getTime()))
          throw rateLimited();

        await lock(`user:${userDid}`, async () => {
          const documentId = await userStatsDocument(index, userDid);
          await execute(documentId, [
            statsActions.setStat({
              id: generateId(),
              appDid,
              metric: args.metric,
              value: args.value,
              updatedAt: now().toISOString(),
            }),
          ]);
        });
        return true;
      },

      upsertAppProfile: async (
        _: unknown,
        args: UpsertAppProfileArgs,
        ctx: ResolverContext,
      ): Promise<boolean> => {
        const appDid = canonicalAppDid(args.appDid);
        if (appDid === null)
          throw invalidRequest("appDid must be a did:key DID");
        const caller = ctx.user?.address?.toLowerCase();
        if (!caller) throw forbidden();
        const fields: ProfileFields = {
          name: args.name,
          tagline: args.tagline,
          logo: args.logo,
          website: args.website,
        };
        assertProfileFields(fields);
        const index = requireIndex();
        if (!profileRateLimiter.take(caller, now().getTime()))
          throw rateLimited();

        await lock(`app:${appDid}`, async () => {
          let entry = await index.appProfile(appDid);
          if (!entry) {
            // Only the registered identity's owner may claim its profile. A
            // delegation is no proof: anyone can self-publish one to any did:key.
            if ((await ownerOf(appDid)) !== caller) throw forbidden();
            const created = (
              await reactorClient.createEmpty(renownAppProfileDocumentType)
            ).header.id;
            await execute(created, [
              profileActions.setAppDid({ appDid }),
              profileActions.setPublisherDid({
                publisherDid: pkhDidFor(caller),
              }),
            ]);
            entry = await index.claimAppProfile(
              { appDid, documentId: created, publisherAddress: caller },
              now(),
            );
          }
          if (entry.publisherAddress !== caller) throw forbidden();
          if (Object.values(fields).some((value) => value != null)) {
            await execute(entry.documentId, [
              profileActions.setProfile(fields),
            ]);
          }
        });
        return true;
      },
    },
  };
}
