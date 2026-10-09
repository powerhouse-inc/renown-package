import type { IReactorClient } from "@powerhousedao/reactor";
import { verifyAuthBearerToken } from "@renown/sdk";
import { generateId, type Action, type PHDocument } from "document-model";
import { GraphQLError } from "graphql";
import {
  actions as profileActions,
  isLogo,
  isWebsite,
  renownAppProfileDocumentType,
  type RenownAppMetric,
  type RenownAppProfileDocument,
} from "../../document-models/renown-app-profile/index.js";
import {
  actions as statsActions,
  isMetricName,
  renownUserStatsDocumentType,
  type RenownUserStatsDocument,
} from "../../document-models/renown-user-stats/index.js";
import type { MediaBackend } from "../../media/backend.js";
import { mediaBackend } from "../../media/slot.js";
import { storedImageProblem } from "../../media/stored-image.js";
import { createRateLimiter } from "../renown-auth/core/rate-limit.js";
import type { ReadModelDb } from "../renown-auth/lookups.js";
import { constantTimeEqual } from "../renown-oidc/core/crypto.js";
import {
  AppProfileInputError,
  appLinkActions,
  toRichProfilePatch,
  type AppProfileLink,
  type RichProfileFields,
  type RichProfilePatch,
} from "./core/app-profile-patch.js";
import {
  metricActions,
  toAppMetric,
  toMetricsPatch,
  type AppMetric,
  type AppMetricInput,
} from "./core/app-metrics-patch.js";
import {
  ACTIVE_WINDOW_MS,
  metricValue,
  TOP_CONTRIBUTORS,
} from "./core/app-stats.js";
import { REGISTRAR_HEADER } from "./core/config.js";
import {
  addressOf,
  canonicalAppDid,
  canonicalUserDid,
  pkhDidFor,
} from "./core/dids.js";
import { createKeyedLock } from "./core/keyed-lock.js";
import {
  activeCredentialCount,
  contributorProfiles,
  hasDelegation,
  identityCount,
  workloadOwner,
  type ContributorProfile,
} from "./lookups.js";
import type {
  AppCategoryCount,
  AppProfileCursor,
  AppProfileEntry,
  StatsIndex,
} from "./store/types.js";

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
/** appProfiles page sizes. */
const DEFAULT_PAGE = 20;
const MAX_PAGE = 50;
/** How long renownNetworkStats serves one computation. */
export const NETWORK_STATS_TTL_MS = 300_000;
/** Which upsert argument holds which upload purpose. */
const IMAGE_FIELDS = [
  ["logoRef", "logo"],
  ["coverRef", "cover"],
] as const;

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
  /**
   * App DIDs whose host bearers may upsert profiles (`RENOWN_STATS_PROFILE_APPS`),
   * for server-held stable keys only: a browser's bearer is signed by a random
   * per-browser did:key. Empty (the default) leaves the relay as the only way.
   */
  profileApps(): ReadonlySet<string>;
  /**
   * `RENOWN_WORKLOAD_REGISTRATION_TOKEN`. Its holder (the Vetra relay) may
   * write a profile for the wallet whose bearer it forwards. Null or absent:
   * relaying is off.
   */
  registrationToken?: () => string | null;
  /** Where image refs are checked; defaults to the backend the media processor published. */
  media?: () => MediaBackend | null;
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

interface UpsertAppProfileArgs extends ProfileFields, RichProfileFields {
  appDid: string;
  /** The whole desired metric list; absent or null leaves it unchanged. */
  metrics?: readonly AppMetricInput[] | null;
}

interface UserStatOutput {
  appDid: string;
  metric: string;
  value: number;
  updatedAt: string;
  /** The app's profile, when it has one. */
  appName: string | null;
  appDocumentId: string | null;
  appHasLogo: boolean;
  /** The app profile's logo attachment ref (versions the media URL). */
  appLogoRef: string | null;
  appLogo: string | null;
  /** Set when the app declares this metric public. */
  label: string | null;
  unit: string | null;
}

interface MetricContributorOutput {
  userDid: string;
  value: number;
  /** The wallet behind a did:pkh user; null for did:key users. */
  address: string | null;
  handle: string | null;
  displayName: string | null;
  documentId: string | null;
  hasAvatar: boolean;
  /** The profile's avatar attachment ref (versions the media URL). */
  avatar: string | null;
  userImage: string | null;
}

interface AppMetricStatOutput {
  key: string;
  label: string;
  unit: string | null;
  description: string | null;
  aggregation: AppMetric["aggregation"];
  value: number;
  users: number;
  top: MetricContributorOutput[];
}

interface AppStatsOutput {
  appDid: string;
  activeUsers30d: number;
  totalUsers: number;
  metrics: AppMetricStatOutput[];
  updatedAt: string | null;
}

interface NetworkStatsOutput {
  identities: number;
  apps: number;
  activeCredentials: number;
  activeUsers30d: number;
  updatedAt: string;
}

/** What stats readers need of an app's profile. */
interface AppCard {
  documentId: string;
  name: string | null;
  hasLogo: boolean;
  logoRef: string | null;
  logo: string | null;
  metrics: AppMetric[];
}

/** An app profile exists but could not be read: its stats are withheld. */
const UNREADABLE = Symbol("unreadable");

interface AppProfileOutput {
  appDid: string;
  documentId: string;
  name: string | null;
  tagline: string | null;
  logo: string | null;
  website: string | null;
  publisherDid: string | null;
  description: string | null;
  category: string | null;
  logoRef: string | null;
  coverRef: string | null;
  links: AppProfileLink[];
  metrics: AppMetric[];
}

const forbidden = () =>
  new GraphQLError("Forbidden", { extensions: { code: "FORBIDDEN" } });
const invalidRequest = (message: string) =>
  new GraphQLError(message, { extensions: { code: "BAD_USER_INPUT" } });
/** A profile argument the caller must fix; `field` lets a form show it inline. */
const fieldError = (code: string, field: string, message: string) =>
  new GraphQLError(message, { extensions: { code, field } });
const rateLimited = () =>
  new GraphQLError("Rate limited", { extensions: { code: "RATE_LIMITED" } });
const notConfigured = () =>
  new GraphQLError("renown-stats is not available", {
    extensions: { code: "SERVICE_NOT_CONFIGURED" },
  });

/** Rejects oversized or unsafe legacy profile fields before anything is written ("" means clear). */
function assertProfileFields(fields: ProfileFields): void {
  for (const key of ["name", "tagline", "website", "logo"] as const) {
    const value = fields[key];
    if (value != null && value.length > MAX_LENGTH[key]) {
      throw fieldError(
        "BAD_USER_INPUT",
        key,
        `${key} exceeds ${MAX_LENGTH[key]} characters`,
      );
    }
  }
  const website = fields.website?.trim();
  if (website && !isWebsite(website))
    throw fieldError(
      "BAD_USER_INPUT",
      "website",
      "website must be an http(s) URL",
    );
  const logo = fields.logo?.trim();
  if (logo && !isLogo(logo))
    throw fieldError(
      "BAD_USER_INPUT",
      "logo",
      "logo must be an https URL or a base64 image data URL",
    );
}

/** The opaque appProfiles cursor: base64url of {t: createdAt ISO, d: appDid}. */
function encodeCursor(cursor: AppProfileCursor): string {
  return Buffer.from(
    JSON.stringify({ t: cursor.createdAt.toISOString(), d: cursor.appDid }),
  ).toString("base64url");
}

function decodeCursor(raw: string): AppProfileCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    ) as {
      t?: unknown;
      d?: unknown;
    };
    const createdAt = new Date(
      typeof parsed.t === "string" ? parsed.t : Number.NaN,
    );
    if (typeof parsed.d !== "string" || Number.isNaN(createdAt.getTime())) {
      throw new Error("malformed cursor");
    }
    return { createdAt, appDid: parsed.d };
  } catch {
    throw invalidRequest("after is not a cursor from appProfiles");
  }
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
  const registrationToken = deps.registrationToken ?? (() => null);
  const media = deps.media ?? mediaBackend;
  const lock = createKeyedLock();
  /** The last renownNetworkStats answer, until expiresAt (ms); failures are never cached. */
  let networkStats: { value: NetworkStatsOutput; expiresAt: number } | undefined;
  let networkStatsLoad: Promise<NetworkStatsOutput> | undefined;

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
      // A CI workload token (it carries the `vetra` claim) is for the Vetra
      // CI endpoints, never a stats credential, whatever its audience.
      if ("vetra" in verified.payload) return undefined;
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
      // Defensive only: verifyAuthBearerToken catches its own failures
      // (console.error-ing them itself) and resolves false, so this branch is
      // not normally reached and does not keep bad tokens out of error logs.
      // If something here does throw, log at debug: anyone can send a token.
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

  /**
   * "absent" without the relay header, "valid" when it carries the configured
   * registration token, else "invalid" (a wrong, empty or repeated header, or
   * no token configured) — which never falls back to the app-key rule.
   */
  function relayHeader(ctx: ResolverContext): "absent" | "valid" | "invalid" {
    const header = ctx.headers?.[REGISTRAR_HEADER];
    if (header === undefined) return "absent";
    const token = registrationToken();
    return typeof header === "string" &&
      token !== null &&
      constantTimeEqual(header, token)
      ? "valid"
      : "invalid";
  }

  /** INVALID_IMAGE unless every image ref the patch sets is a stored image within its limits. */
  async function assertImages(patch: RichProfilePatch): Promise<void> {
    for (const [field, purpose] of IMAGE_FIELDS) {
      const ref = patch[field];
      if (!ref) continue;
      const backend = media();
      if (!backend) {
        throw new GraphQLError("Image uploads are not available", {
          extensions: { code: "SERVICE_UNAVAILABLE" },
        });
      }
      let problem: string | null;
      try {
        problem = await storedImageProblem(ref, backend, purpose);
      } catch (error) {
        // Storage could not be read: say so, rather than blaming the image.
        const reason = error instanceof Error ? error.message : String(error);
        console.warn(`[renown-stats] ${purpose} inspection failed (${reason})`);
        throw new GraphQLError("Image storage is unavailable", {
          extensions: { code: "SERVICE_UNAVAILABLE" },
        });
      }
      if (problem)
        throw fieldError(
          "INVALID_IMAGE",
          field,
          `Invalid ${purpose}: ${problem}`,
        );
    }
  }

  /** The actions that apply `fields`, `patch` and `metrics` to the profile document. */
  async function profileWrite(
    documentId: string,
    fields: ProfileFields,
    patch: RichProfilePatch,
    metrics: AppMetric[] | undefined,
  ): Promise<Action[]> {
    const scalars = {
      ...fields,
      description: patch.description,
      category: patch.category,
      logoRef: patch.logoRef,
      coverRef: patch.coverRef,
    };
    const actions: Action[] = [];
    if (Object.values(scalars).some((value) => value != null)) {
      actions.push(profileActions.setProfile(scalars));
    }
    if (patch.links || metrics) {
      const document =
        await reactorClient.get<RenownAppProfileDocument>(documentId);
      // Profiles from before links (Phase 2) or metrics (Phase 3) have no list at all.
      const state = document.state.global as {
        links?: AppProfileLink[];
        metrics?: RenownAppMetric[];
      };
      if (patch.links)
        actions.push(...appLinkActions(state.links ?? [], patch.links));
      if (metrics) {
        actions.push(
          ...metricActions((state.metrics ?? []).map(toAppMetric), metrics),
        );
      }
    }
    return actions;
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
    // Profiles from before the rich fields have none of their keys.
    const state = doc.state.global as Partial<
      RenownAppProfileDocument["state"]["global"]
    >;
    return {
      appDid: entry.appDid,
      documentId: entry.documentId,
      name: state.name ?? null,
      tagline: state.tagline ?? null,
      logo: state.logo ?? null,
      website: state.website ?? null,
      publisherDid: state.publisherDid ?? null,
      description: state.description ?? null,
      category: state.category ?? null,
      logoRef: state.logoRef ?? null,
      coverRef: state.coverRef ?? null,
      links: (state.links ?? []).map(({ id, label, url }) => ({
        id,
        label,
        url,
      })),
      metrics: (state.metrics ?? []).map(toAppMetric),
    };
  }

  /** The outputs of the entries whose document loads; an unloadable one is skipped and logged. */
  async function profileOutputs(
    entries: readonly AppProfileEntry[],
  ): Promise<AppProfileOutput[]> {
    const settled = await Promise.allSettled(entries.map(profileOutput));
    const out: AppProfileOutput[] = [];
    settled.forEach((result, i) => {
      if (result.status === "fulfilled") {
        out.push(result.value);
        return;
      }
      const reason =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
      console.warn(
        `[renown-stats] app profile ${entries[i]?.documentId} unreadable (${reason}); skipped`,
      );
    });
    return out;
  }

  /** The app's profile as stats readers need it; null without one ; UNREADABLE when it exists but cannot be read. */
  async function appCard(
    index: StatsIndex,
    appDid: string,
  ): Promise<AppCard | null | typeof UNREADABLE> {
    const entry = await index.appProfile(appDid);
    if (!entry) return null;
    try {
      const doc = await reactorClient.get<RenownAppProfileDocument>(
        entry.documentId,
      );
      const state = doc.state.global as Partial<
        RenownAppProfileDocument["state"]["global"]
      >;
      return {
        documentId: entry.documentId,
        name: state.name ?? null,
        hasLogo: !!state.logoRef,
        logoRef: state.logoRef || null,
        logo: state.logo ?? null,
        metrics: (state.metrics ?? []).map(toAppMetric),
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(
        `[renown-stats] app profile ${entry.documentId} unreadable (${reason}); its stats are withheld`,
      );
      return UNREADABLE;
    }
  }

  /** Renown profiles behind did:pkh user DIDs, by lowercase address. Never throws. */
  async function contributors(
    userDids: readonly string[],
  ): Promise<Map<string, ContributorProfile>> {
    const addresses = [
      ...new Set(
        userDids.map(addressOf).filter((a): a is string => a !== null),
      ),
    ];
    if (addresses.length === 0) return new Map();
    try {
      return await contributorProfiles(relationalDb, addresses);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(
        `[renown-stats] contributor profile lookup failed (${reason}); showing addresses`,
      );
      return new Map();
    }
  }

  /** Log the reason and answer SERVICE_UNAVAILABLE, never the raw error. */
  function unavailable(error: unknown): GraphQLError {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[renown-stats] read failed (${reason})`);
    return new GraphQLError("Stats are temporarily unavailable", {
      extensions: { code: "SERVICE_UNAVAILABLE" },
    });
  }

  /** Fresh network-wide counts, read from three namespaces in parallel. */
  async function computeNetworkStats(
    index: StatsIndex,
  ): Promise<NetworkStatsOutput> {
    const at = now();
    const since = new Date(at.getTime() - ACTIVE_WINDOW_MS);
    try {
      const [activity, identities, activeCredentials] = await Promise.all([
        index.networkActivity(since),
        identityCount(relationalDb),
        activeCredentialCount(relationalDb, at),
      ]);
      return {
        identities,
        apps: activity.apps,
        activeCredentials,
        activeUsers30d: activity.activeUsers,
        updatedAt: at.toISOString(),
      };
    } catch (error) {
      throw unavailable(error);
    }
  }

  function contributorOutput(
    top: { userDid: string; value: number },
    profiles: Map<string, ContributorProfile>,
  ): MetricContributorOutput {
    const address = addressOf(top.userDid);
    const profile = address ? profiles.get(address) : undefined;
    return {
      userDid: top.userDid,
      value: top.value,
      address,
      handle: profile?.handle ?? null,
      displayName: profile?.displayName ?? null,
      documentId: profile?.documentId ?? null,
      hasAvatar: profile?.hasAvatar ?? false,
      avatar: profile?.avatar ?? null,
      userImage: profile?.userImage ?? null,
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
        const index = requireIndex();
        try {
          const documentId = await index.userStatsDocument(userDid);
          if (!documentId) return [];
          const doc =
            await reactorClient.get<RenownUserStatsDocument>(documentId);
          const stats = doc.state.global.stats;
          const appDids = [...new Set(stats.map((stat) => stat.appDid))];
          const cards = new Map(
            await Promise.all(
              appDids.map(
                async (appDid) =>
                  [appDid, await appCard(index, appDid)] as const,
              ),
            ),
          );
          const out: UserStatOutput[] = [];
          for (const { appDid, metric, value, updatedAt } of stats) {
            const card = cards.get(appDid) ?? null;
            // A profile that cannot be read might declare this metric private.
            if (card === UNREADABLE) continue;
            const declared = card?.metrics.find((m) => m.key === metric);
            // A metric its publisher declared private is shown nowhere.
            if (declared && !declared.public) continue;
            out.push({
              appDid,
              metric,
              value,
              updatedAt,
              appName: card?.name ?? null,
              appDocumentId: card?.documentId ?? null,
              appHasLogo: card?.hasLogo ?? false,
              appLogoRef: card?.logoRef ?? null,
              appLogo: card?.logo ?? null,
              label: declared?.label ?? null,
              unit: declared?.unit ?? null,
            });
          }
          return out;
        } catch (error) {
          throw unavailable(error);
        }
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
        return profileOutputs(entries);
      },

      appProfiles: async (
        _: unknown,
        args: {
          limit?: number | null;
          after?: string | null;
          category?: string | null;
        },
      ): Promise<{ items: AppProfileOutput[]; next: string | null }> => {
        const limit = args.limit ?? DEFAULT_PAGE;
        if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) {
          throw invalidRequest(`limit must be 1-${MAX_PAGE}`);
        }
        const after = args.after ? decodeCursor(args.after) : undefined;
        // Stored categories are trimmed; blank means no filter.
        const category = args.category?.trim() || undefined;
        const entries = await requireIndex().appProfilesPage(
          limit + 1,
          after,
          category,
        );
        const page = entries.slice(0, limit);
        const last = page.at(-1);
        return {
          items: await profileOutputs(page),
          next:
            entries.length > limit && last
              ? encodeCursor({ createdAt: last.createdAt, appDid: last.appDid })
              : null,
        };
      },

      appProfileCategories: async (): Promise<AppCategoryCount[]> => {
        const index = requireIndex();
        try {
          return await index.appProfileCategories();
        } catch (error) {
          throw unavailable(error);
        }
      },

      renownNetworkStats: async (): Promise<NetworkStatsOutput> => {
        const index = requireIndex();
        if (networkStats && now().getTime() < networkStats.expiresAt) {
          return networkStats.value;
        }
        // Concurrent requests share one computation.
        networkStatsLoad ??= computeNetworkStats(index)
          .then((value) => {
            networkStats = {
              value,
              expiresAt: new Date(value.updatedAt).getTime() + NETWORK_STATS_TTL_MS,
            };
            return value;
          })
          .finally(() => {
            networkStatsLoad = undefined;
          });
        return networkStatsLoad;
      },

      appStats: async (
        _: unknown,
        args: { appDid: string },
      ): Promise<AppStatsOutput | null> => {
        const appDid = canonicalAppDid(args.appDid);
        if (appDid === null)
          throw invalidRequest("appDid must be a did:key DID");
        const index = requireIndex();
        const since = new Date(now().getTime() - ACTIVE_WINDOW_MS);
        try {
          const [found, activity] = await Promise.all([
            appCard(index, appDid),
            index.appActivity(appDid, since),
          ]);
          // An unreadable profile declares nothing we can vouch for as public.
          const card = found === UNREADABLE ? null : found;
          if (!found && activity.totalUsers === 0) return null;
          // Only metrics the publisher declared public. Undeclared values stay
          // stored (declaring later shows their history) but are never exposed.
          const declared = (card?.metrics ?? []).filter((m) => m.public);
          const aggregates = await index.metricAggregates(
            appDid,
            declared.map((m) => m.key),
            TOP_CONTRIBUTORS,
          );
          const byMetric = new Map(aggregates.map((a) => [a.metric, a]));
          const profiles = await contributors(
            aggregates.flatMap((a) => a.top.map((t) => t.userDid)),
          );
          return {
            appDid,
            activeUsers30d: activity.activeUsers,
            totalUsers: activity.totalUsers,
            updatedAt: activity.updatedAt?.toISOString() ?? null,
            metrics: declared.map((m) => {
              const aggregate = byMetric.get(m.key);
              return {
                key: m.key,
                label: m.label,
                unit: m.unit,
                description: m.description,
                aggregation: m.aggregation,
                value: metricValue(m.aggregation, aggregate),
                users: aggregate?.users ?? 0,
                top: (aggregate?.top ?? []).map((t) =>
                  contributorOutput(t, profiles),
                ),
              };
            }),
          };
        } catch (error) {
          throw unavailable(error);
        }
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
          // Stats are current values: an unchanged value appends no operation.
          const current =
            await reactorClient.get<RenownUserStatsDocument>(documentId);
          const stored = current.state.global.stats.find(
            (stat) => stat.appDid === appDid && stat.metric === args.metric,
          );
          const at = now();
          if (stored?.value !== args.value) {
            await execute(documentId, [
              statsActions.setStat({
                id: generateId(),
                appDid,
                metric: args.metric,
                value: args.value,
                updatedAt: at.toISOString(),
              }),
            ]);
          }
          // The app-level aggregate row, right after the accepted report and
          // under the same per-user lock. Every report rewrites it: it marks
          // the user active, and repairs a row a crash left behind.
          try {
            await index.recordMetricValues([
              {
                appDid,
                metric: args.metric,
                userDid,
                value: args.value,
                updatedAt: at,
              },
            ]);
          } catch (error) {
            // The document write above already succeeded; the next report of
            // this metric repairs the row. Never leak the database error.
            const reason =
              error instanceof Error ? error.message : String(error);
            console.warn(
              `[renown-stats] metric aggregate write failed (${reason})`,
            );
            throw new GraphQLError("Stats are temporarily unavailable", {
              extensions: { code: "SERVICE_UNAVAILABLE" },
            });
          }
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
        // Which client may write: the Vetra relay (registration token, plus
        // the publisher's own bearer), or a bearer signed by a listed app key.
        // A browser's bearer alone never qualifies: its did:key is random per
        // browser and any site the wallet signed into can mint one.
        const relay = relayHeader(ctx);
        if (relay === "invalid") throw forbidden();
        if (relay === "absent") {
          const appKey = ctx.user?.appKey;
          if (!appKey || !deps.profileApps().has(appKey)) throw forbidden();
        }
        const fields: ProfileFields = {
          name: args.name,
          tagline: args.tagline,
          logo: args.logo,
          website: args.website,
        };
        assertProfileFields(fields);
        let patch: RichProfilePatch;
        let metrics: AppMetric[] | undefined;
        try {
          patch = toRichProfilePatch(args);
          metrics = toMetricsPatch(args.metrics);
        } catch (error) {
          if (error instanceof AppProfileInputError)
            throw fieldError("BAD_USER_INPUT", error.field, error.message);
          throw error;
        }
        const index = requireIndex();
        if (!profileRateLimiter.take(caller, now().getTime()))
          throw rateLimited();

        await lock(`app:${appDid}`, async () => {
          let entry = await index.appProfile(appDid);
          // Only the registered identity's owner may claim a profile, and only
          // its publisher may edit one. A delegation is no proof: anyone can
          // self-publish one to any did:key.
          const allowed = entry
            ? entry.publisherAddress === caller
            : (await ownerOf(appDid)) === caller;
          if (!allowed) throw forbidden();
          await assertImages(patch);
          if (!entry) {
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
            if (entry.publisherAddress !== caller) throw forbidden();
          }
          const actions = await profileWrite(
            entry.documentId,
            fields,
            patch,
            metrics,
          );
          if (actions.length > 0) await execute(entry.documentId, actions);
          // Every save heals the image and category index from the resulting document, so a
          // failed write on an earlier save is repaired by the next one.
          try {
            const saved = await reactorClient.get<RenownAppProfileDocument>(
              entry.documentId,
            );
            const state = saved.state.global as Partial<
              RenownAppProfileDocument["state"]["global"]
            >;
            await index.setAppImages(
              entry.documentId,
              {
                logoRef: state.logoRef || null,
                coverRef: state.coverRef || null,
              },
              now(),
            );
            await index.setAppCategory(appDid, state.category ?? null);
          } catch (error) {
            // The document is already saved; a retry of the save repairs the index.
            const reason =
              error instanceof Error ? error.message : String(error);
            console.warn(
              `[renown-stats] app image index write failed (${reason})`,
            );
            throw new GraphQLError("Image index is temporarily unavailable", {
              extensions: { code: "SERVICE_UNAVAILABLE" },
            });
          }
        });
        return true;
      },
    },
  };
}
