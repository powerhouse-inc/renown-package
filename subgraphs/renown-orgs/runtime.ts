import type { IReactorClient } from "@powerhousedao/reactor";
import { generateId, type Action, type PHDocument } from "document-model";
import type { MediaBackend } from "../../media/backend.js";
import { sha256Hex } from "../../sdk/orgs.js";
import { mediaBackend } from "../../media/slot.js";
import { createRateLimiter } from "../renown-auth/core/rate-limit.js";
import type { ReadModelDb } from "../renown-auth/lookups.js";
import { createKeyedLock } from "../renown-stats/core/keyed-lock.js";
import { createActivityRecorder, type ActivitySink, type OrgActivity } from "./core/activity.js";
import { provenAddress, requireAddress, type OrgArgs, type OrgContext } from "./core/auth.js";
import type { OrgsConfig } from "./core/config.js";
import { badInput, forbidden, rateLimited, unavailable } from "./core/errors.js";
import type { OrgStore } from "./store/types.js";

export type RateLimiter = { take(key: string, now?: number): boolean };
export type Resolver = (parent: unknown, args: never, ctx: OrgContext) => Promise<unknown>;
export type Area = (rt: OrgRuntime) => { Query?: Record<string, Resolver>; Mutation?: Record<string, Resolver> };

export const WRITES_PER_MINUTE = 60;
export const INVITES_PER_HOUR = 50;
/** How long a signed `auth` stays fresh after its timestamp (and so how long its hash is kept). */
export const SIGNATURE_TTL_MS = 600_000;

export interface OrgsResolverDeps {
  reactorClient: Pick<IReactorClient, "createEmpty" | "execute" | "get">;
  relationalDb: ReadModelDb;
  /** Undefined until set up, or when the relational namespace is unavailable. */
  store(): OrgStore | undefined;
  config(): OrgsConfig;
  now?: () => Date;
  newId?: () => string;
  randomBytes?: (length: number) => Uint8Array;
  /** Where avatar refs are checked; defaults to the backend the media processor published. */
  media?: () => MediaBackend | null;
  writeLimiter?: RateLimiter;
  inviteLimiter?: RateLimiter;
  /** Extra activity sinks (A3: notifications, webhooks). */
  sinks?: readonly ActivitySink[];
  /** Initial membership-ended hooks (tests; A2 registers its own on the runtime). */
  membershipHooks?: readonly ((event: MembershipEnded) => Promise<void>)[];
}

/** A membership that just ended (LEFT or REMOVED); A2 suspends the member's org-app credentials. */
export interface MembershipEnded {
  orgId: string;
  memberId: string;
  address: string;
  reason: "LEFT" | "REMOVED";
  actor: string;
  at: Date;
}

export interface OrgRuntime {
  readonly deps: OrgsResolverDeps;
  now(): Date;
  /** The store, or SERVICE_UNAVAILABLE. */
  store(): OrgStore;
  config(): OrgsConfig;
  media(): MediaBackend | null;
  newId(): string;
  /** `bytes` random bytes, base64url. */
  token(bytes?: number): string;
  lock<T>(key: string, fn: () => Promise<T>): Promise<T>;
  /**
   * The proven caller of a write; spends one of their 60 writes a minute. A
   * signed `auth` is single use: a replay is FORBIDDEN.
   */
  writer(ctx: OrgContext, field: string, args: OrgArgs): Promise<string>;
  /** The proven caller of a read that needs one. */
  caller(ctx: OrgContext, field: string, args: OrgArgs): Promise<string>;
  /** The caller when they prove an address, else null (a wrong auth is still FORBIDDEN). */
  viewer(ctx: OrgContext, field: string, args: OrgArgs): Promise<string | null>;
  /** Spends one of the org's 50 invites an hour, or RATE_LIMITED. */
  takeInvite(orgId: string): void;
  createDocument(documentType: string): Promise<string>;
  /** Applies `actions` to a document; a rejected operation is BAD_USER_INPUT (field "document"). */
  execute(documentId: string, actions: Action[]): Promise<void>;
  record(activity: OrgActivity): Promise<void>;
  readonly hooks: { membershipEnded: ((event: MembershipEnded) => Promise<void>)[] };
}

export function createRuntime(deps: OrgsResolverDeps): OrgRuntime {
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? generateId;
  const randomBytes = deps.randomBytes ?? ((length: number) => crypto.getRandomValues(new Uint8Array(length)));
  const writeLimiter = deps.writeLimiter ?? createRateLimiter(WRITES_PER_MINUTE, 60_000);
  const inviteLimiter = deps.inviteLimiter ?? createRateLimiter(INVITES_PER_HOUR, 3_600_000);
  const lock = createKeyedLock();
  const store = (): OrgStore => {
    const current = deps.store();
    if (!current) throw unavailable();
    return current;
  };
  const record = createActivityRecorder({ store, newId, sinks: deps.sinks ?? [] });

  return {
    deps,
    now,
    store,
    config: () => deps.config(),
    media: () => (deps.media ?? mediaBackend)(),
    newId,
    token: (bytes = 32) => Buffer.from(randomBytes(bytes)).toString("base64url"),
    lock,
    async writer(ctx, field, args) {
      const address = await requireAddress(ctx, field, args, now());
      // requireAddress verified a present auth (or threw); spend its signature once.
      if (args.auth) {
        const hash = await sha256Hex(args.auth.signature.toLowerCase());
        const expiresAt = new Date(Date.parse(args.auth.timestamp) + SIGNATURE_TTL_MS);
        if (!(await store().useSignature(hash, expiresAt))) throw forbidden("signature already used");
      }
      if (!writeLimiter.take(address, now().getTime())) throw rateLimited();
      return address;
    },
    caller: (ctx, field, args) => requireAddress(ctx, field, args, now()),
    viewer: (ctx, field, args) => provenAddress(ctx, field, args, now()),
    takeInvite(orgId) {
      if (!inviteLimiter.take(orgId, now().getTime())) throw rateLimited();
    },
    async createDocument(documentType) {
      return (await deps.reactorClient.createEmpty(documentType)).header.id;
    },
    async execute(documentId, actions) {
      if (actions.length === 0) return;
      const document: PHDocument = await deps.reactorClient.execute(documentId, "main", actions);
      const sent = new Set(actions.map((action) => action.id));
      const failed = Object.values(document.operations)
        .flat()
        .find((operation) => operation.error && sent.has(operation.action.id));
      if (failed?.error) throw badInput("document", `${failed.action.type} failed: ${failed.error}`);
    },
    record,
    hooks: { membershipEnded: [...(deps.membershipHooks ?? [])] },
  };
}
