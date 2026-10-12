import type { ActivitySink } from "../core/activity.js";
import type { OrgArgs, OrgContext } from "../core/auth.js";
import { isAdminRole } from "../core/authz.js";
import { badInput } from "../core/errors.js";
import { iso, isoOrNull, orgSummaries } from "../output.js";
import type { Area, OrgRuntime } from "../runtime.js";
import type { MemberRecord, NotificationRecord } from "../store/types.js";

export const NOTIFICATION_RETENTION_DAYS = 90;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
/** Ids per markNotificationsRead call. */
const MAX_IDS = 100;

/**
 * Turns an activity's notification intents into inbox rows: never for the
 * actor, at most once per recipient and kind. "OWNERS" and "ADMINS" resolve
 * to the org's ACTIVE members at the time of the activity. A failure here is
 * logged by the activity recorder; it never fails the mutation.
 */
export function notificationSink(rt: OrgRuntime): ActivitySink {
  return async (activity) => {
    if (!activity.notify?.length) return;
    const store = rt.store();
    let active: MemberRecord[] | undefined;
    const rows: NotificationRecord[] = [];
    const seen = new Set<string>();
    for (const intent of activity.notify) {
      let recipients: string[];
      if (intent.to === "OWNERS" || intent.to === "ADMINS") {
        active ??= await store.members(activity.orgId, ["ACTIVE"]);
        const admins = intent.to === "ADMINS";
        recipients = active.filter((m) => (admins ? isAdminRole(m.role) : m.role === "OWNER")).map((m) => m.address.toLowerCase());
      } else {
        recipients = intent.to.map((address) => address.toLowerCase());
      }
      for (const recipient of recipients) {
        const key = `${recipient}\u0000${intent.kind}`;
        if (recipient === activity.actor || seen.has(key)) continue;
        seen.add(key);
        rows.push({
          id: rt.newId(),
          recipient,
          kind: intent.kind,
          orgId: activity.orgId,
          payload: { ...(intent.payload ?? {}), orgId: activity.orgId },
          createdAt: activity.at,
          readAt: null,
        });
      }
    }
    await store.insertNotifications(rows);
  };
}

function cursorOf(raw: string): { createdAt: Date; id: string } {
  try {
    const cursor = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as { c?: unknown; i?: unknown };
    const createdAt = typeof cursor.c === "string" ? new Date(cursor.c) : new Date(Number.NaN);
    if (Number.isNaN(createdAt.getTime()) || typeof cursor.i !== "string" || cursor.i.length > 255) throw new Error("malformed cursor");
    return { createdAt, id: cursor.i };
  } catch {
    throw badInput("after", "after is not a cursor from myNotifications");
  }
}

function cursorFor(note: NotificationRecord): string {
  return Buffer.from(JSON.stringify({ c: iso(note.createdAt), i: note.id })).toString("base64url");
}

/** Runtimes whose notification sink is registered: resolvers built twice on one runtime must not notify twice. */
const registered = new WeakSet<OrgRuntime>();

/**
 * The caller's own inbox. Every field reads or changes only the proven
 * caller's notifications (the bearer, or a signature by that same address);
 * there is no recipient argument.
 */
export const notificationResolvers: Area = (rt) => {
  if (!registered.has(rt)) {
    registered.add(rt);
    rt.sinks.push(notificationSink(rt));
  }
  return {
    Query: {
      myNotifications: async (
        _: unknown,
        args: OrgArgs & { unreadOnly?: boolean | null; limit?: number | null; after?: string | null },
        ctx: OrgContext,
      ) => {
        const caller = await rt.caller(ctx, "myNotifications", args);
        const limit = args.limit ?? DEFAULT_LIMIT;
        if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw badInput("limit", `limit must be an integer from 1 to ${MAX_LIMIT}`);
        const after = args.after != null ? cursorOf(args.after) : undefined;
        const store = rt.store();
        const rows = await store.notificationsPage(caller, { unreadOnly: args.unreadOnly === true, limit: limit + 1, after });
        const page = rows.slice(0, limit);
        const orgs = await orgSummaries(rt, await store.organizationsByIds([...new Set(page.map((n) => n.orgId))]));
        const last = page.at(-1);
        return {
          items: page.map((n) => ({
            id: n.id,
            kind: n.kind,
            orgId: n.orgId,
            org: orgs.get(n.orgId) ?? null,
            payload: JSON.stringify(n.payload),
            createdAt: iso(n.createdAt),
            readAt: isoOrNull(n.readAt),
          })),
          next: rows.length > limit && last ? cursorFor(last) : null,
        };
      },
      myUnreadNotificationCount: async (_: unknown, args: OrgArgs, ctx: OrgContext) => {
        const caller = await rt.caller(ctx, "myUnreadNotificationCount", args);
        return rt.store().unreadNotificationCount(caller);
      },
    },
    Mutation: {
      markNotificationsRead: async (_: unknown, args: OrgArgs & { ids?: string[] | null; all?: boolean | null }, ctx: OrgContext) => {
        const caller = await rt.writer(ctx, "markNotificationsRead", args);
        const all = args.all === true;
        if ((args.ids != null) === all) throw badInput("ids", "Pass exactly one of ids and all: true");
        if (args.ids && args.ids.length > MAX_IDS) throw badInput("ids", `At most ${MAX_IDS} ids at a time`);
        return rt.store().markNotificationsRead(caller, all ? "ALL" : (args.ids ?? []), rt.now());
      },
    },
  };
};
