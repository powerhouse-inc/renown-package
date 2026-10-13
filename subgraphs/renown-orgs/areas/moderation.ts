import { actions as orgActions } from "../../../document-models/renown-organization/index.js";
import { createRateLimiter } from "../../renown-auth/core/rate-limit.js";
import type { OrgArgs, OrgContext } from "../core/auth.js";
import { requireOrg, requireRole } from "../core/authz.js";
import { badInput, forbidden, notFound, rateLimited, unavailable } from "../core/errors.js";
import { orgHandleProblem, RELEASED_REASON } from "../core/handles.js";
import { iso, isoOrNull, orgSummaries } from "../output.js";
import type { Area, OrgRuntime } from "../runtime.js";
import type { OrgRecord, OrgStore, ReportRecord, ReportResolution, ReportStatus, ReservedHandleRecord } from "../store/types.js";
import { writeDocument } from "./members.js";

export const MAX_REPORTS_PER_DAY = 5;
export const MAX_REPORT_TEXT = 1000;
export const AUDIT_EXPORT_MAX = 10_000;
export const AUDIT_EXPORTS_PER_HOUR = 10;
export const RELEASED_HANDLE_DAYS = 30;
const DAY_MS = 86_400_000;

const REASONS: ReadonlySet<string> = new Set(["IMPERSONATION", "HANDLE_DISPUTE", "SPAM", "ABUSE", "OTHER"]);
const RESOLUTIONS = ["DISMISS", "TAKE_DOWN", "RELEASE_HANDLE", "RESTORE"] as const;
type Resolution = (typeof RESOLUTIONS)[number];

/**
 * Detail keys an export never carries, at any depth (the audit itself should
 * hold none); identifiers (`…Id`, `…Ids`, such as credentialId) stay.
 */
const SECRET_KEY_RE = /secret|signature|token|password|passphrase|private|key|credential|auth|hmac|jwt|cookie|session/i;
const ID_KEY_RE = /Ids?$/;

/** FORBIDDEN for anyone outside RENOWN_PLATFORM_ADMINS, before anything about reports is looked up. */
function requirePlatformAdmin(rt: OrgRuntime, caller: string): void {
  if (!rt.config().platformAdmins.has(caller.toLowerCase())) throw forbidden();
}

function textArg(field: string, value: string | null | undefined): string | null {
  const text = value?.trim() || null;
  if (text && text.length > MAX_REPORT_TEXT) throw badInput(field, `${field} must be at most ${MAX_REPORT_TEXT} characters`);
  return text;
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => ID_KEY_RE.test(key) || !SECRET_KEY_RE.test(key))
      .map(([key, inner]) => [key, redact(inner)]),
  );
}

async function reportOutputs(rt: OrgRuntime, reports: readonly ReportRecord[]) {
  const orgs = await orgSummaries(rt, await rt.store().organizationsByIds([...new Set(reports.map((r) => r.orgId))]));
  return reports.map((r) => ({
    id: r.id,
    orgId: r.orgId,
    org: orgs.get(r.orgId) ?? null,
    reporter: r.reporter,
    reason: r.reason,
    details: r.details,
    status: r.status,
    resolution: r.resolution,
    resolvedBy: r.resolvedBy,
    resolvedAt: isoOrNull(r.resolvedAt),
    note: r.note,
    createdAt: iso(r.createdAt),
  }));
}

/** org-<first 8 of id>, else with -2, -3 … appended, the first one free. */
async function releasedName(rt: OrgRuntime, org: OrgRecord, now: Date): Promise<string> {
  const base = `org-${org.id.slice(0, 8).toLowerCase().replace(/[^a-z0-9]/g, "0")}`;
  for (let n = 1; n <= 100; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    if ((await orgHandleProblem({ store: rt.store(), relationalDb: rt.deps.relationalDb, now }, candidate, org.id)) === null) return candidate;
  }
  throw unavailable("No replacement handle is free");
}

/** What a resolution changed on the organisation: its org-audit action and org.updated data. */
interface Applied {
  action: string;
  data: Record<string, unknown>;
}

/**
 * Applies the resolution, store first (one transaction with the report's
 * compare-and-set), then the document; a document that cannot be written
 * undoes both and throws SERVICE_UNAVAILABLE. The caller holds org:<id>.
 * Returns the resolved report and, unless DISMISS, what changed.
 */
async function applyResolution(
  rt: OrgRuntime,
  report: ReportRecord,
  org: OrgRecord | undefined,
  resolution: Resolution,
  expected: string | undefined,
  resolved: ReportResolution,
): Promise<{ report: ReportRecord; applied: Applied | null }> {
  const store = rt.store();
  const now = resolved.resolvedAt;
  const resolve = async (tx: OrgStore) => {
    const done = await tx.resolveReport(report.id, resolved, expected);
    if (!done) throw badInput("reportId", "The report is already resolved");
    return done;
  };

  if (resolution === "DISMISS") return { report: await resolve(store), applied: null };
  if (!org) throw notFound("Organization");

  if (resolution === "TAKE_DOWN" || resolution === "RESTORE") {
    const takenDown = resolution === "TAKE_DOWN";
    // Webhook deliveries wait while the organisation is down and resume when it is restored.
    const done = await store.transaction(async (tx) => {
      const result = await resolve(tx);
      await tx.updateOrganization(org.id, { takenDown }, now);
      if (takenDown) await tx.pauseDeliveries(org.id);
      else await tx.resumeDeliveries(org.id, now);
      return result;
    });
    await writeDocument(rt, "resolveOrgReport", org.id, [orgActions.setTakenDown({ takenDown })], () =>
      store.transaction(async (tx) => {
        await tx.updateOrganization(org.id, { takenDown: org.takenDown }, org.updatedAt);
        if (takenDown) await tx.resumeDeliveries(org.id, now);
        else await tx.pauseDeliveries(org.id);
        await tx.restoreReport(report);
      }),
    );
    return { report: done, applied: { action: takenDown ? "moderation.takenDown" : "moderation.restored", data: { fields: ["takenDown"], takenDown } } };
  }

  // RELEASE_HANDLE. Lock order org -> handle, as CHANGE_HANDLE.
  const handle = await releasedName(rt, org, now);
  return rt.lock(`handle:${handle}`, async () => {
    if ((await orgHandleProblem({ store, relationalDb: rt.deps.relationalDb, now }, handle, org.id)) !== null) {
      throw unavailable("The replacement handle was just taken; try again");
    }
    const previous: ReservedHandleRecord | undefined = await store.reservedHandle(org.handle, now);
    const done = await store.transaction(async (tx) => {
      const result = await resolve(tx);
      await tx.updateOrganization(org.id, { handle }, now);
      // Nobody's reservation (orgId null): only the verified-domain exception may claim it.
      await tx.reserveHandle({ handle: org.handle, until: new Date(now.getTime() + RELEASED_HANDLE_DAYS * DAY_MS), reason: RELEASED_REASON, orgId: null });
      return result;
    });
    await writeDocument(rt, "resolveOrgReport", org.id, [orgActions.setOrgHandle({ handle })], () =>
      store.transaction(async (tx) => {
        await tx.updateOrganization(org.id, { handle: org.handle }, org.updatedAt);
        if (previous) await tx.reserveHandle(previous);
        else await tx.deleteReservedHandle(org.handle);
        await tx.restoreReport(report);
      }),
    );
    return { report: done, applied: { action: "moderation.handleReleased", data: { fields: ["handle"], from: org.handle, to: handle } } };
  });
}

export const moderationResolvers: Area = (rt) => {
  const exportLimiter = createRateLimiter(AUDIT_EXPORTS_PER_HOUR, 3_600_000);
  return {
    Query: {
      orgReports: async (_: unknown, args: OrgArgs & { status?: ReportStatus | null }, ctx: OrgContext) => {
        const caller = await rt.caller(ctx, "orgReports", args);
        requirePlatformAdmin(rt, caller);
        return reportOutputs(rt, await rt.store().reports(args.status ?? undefined));
      },
      orgAuditExport: async (_: unknown, args: OrgArgs & { orgId: string }, ctx: OrgContext) => {
        const caller = await rt.caller(ctx, "orgAuditExport", args);
        if (!exportLimiter.take(caller, rt.now().getTime())) throw rateLimited();
        const store = rt.store();
        await requireOrg(store, args.orgId, { writable: false });
        await requireRole(store, args.orgId, caller, "ADMIN");
        const entries = await store.auditPage(args.orgId, AUDIT_EXPORT_MAX);
        return JSON.stringify(entries.map((e) => ({ id: e.id, at: iso(e.at), actor: e.actor, action: e.action, details: redact(e.details) })));
      },
    },
    Mutation: {
      reportOrganization: async (_: unknown, args: OrgArgs & { orgId: string; reason: string; details?: string | null }, ctx: OrgContext) => {
        const caller = await rt.writer(ctx, "reportOrganization", args);
        if (!REASONS.has(args.reason)) throw badInput("reason", "Unknown reason");
        const details = textArg("details", args.details);
        const store = rt.store();
        if (!(await store.organization(args.orgId))) throw notFound("Organization");
        // Count and insert under one lock, so parallel reports cannot pass the daily limit.
        return rt.lock(`report:${caller}`, async () => {
          const now = rt.now();
          if ((await store.countReportsSince(caller, new Date(now.getTime() - DAY_MS))) >= MAX_REPORTS_PER_DAY) throw rateLimited();
          await store.insertReport({
            id: rt.newId(),
            orgId: args.orgId,
            reporter: caller,
            reason: args.reason,
            details,
            status: "OPEN",
            resolution: null,
            resolvedBy: null,
            resolvedAt: null,
            note: null,
            createdAt: now,
          });
          return true;
        });
      },
      resolveOrgReport: async (_: unknown, args: OrgArgs & { reportId: string; resolution: string; note?: string | null }, ctx: OrgContext) => {
        const caller = await rt.writer(ctx, "resolveOrgReport", args);
        requirePlatformAdmin(rt, caller);
        const resolution = RESOLUTIONS.find((r) => r === args.resolution);
        if (!resolution) throw badInput("resolution", "Unknown resolution");
        const note = textArg("note", args.note);
        const found = await rt.store().report(args.reportId);
        if (!found) throw notFound("Report");
        return rt.lock(`org:${found.orgId}`, async () => {
          const store = rt.store();
          const now = rt.now();
          const report = await store.report(found.id);
          if (!report) throw notFound("Report");
          // An OPEN report takes any resolution; a taken-down organisation is restored on its TAKE_DOWN report.
          let expected: string | undefined;
          if (report.status !== "OPEN") {
            if (resolution !== "RESTORE" || report.resolution !== "TAKE_DOWN") throw badInput("reportId", "The report is already resolved");
            expected = "TAKE_DOWN";
          }
          const org = await store.organization(report.orgId);
          const { report: resolved, applied } = await applyResolution(rt, report, org, resolution, expected, {
            resolution,
            resolvedBy: caller,
            resolvedAt: now,
            note,
          });
          // The org audit gets only what changed; reason, note and reporter stay in the platform-only report.
          if (org && applied) {
            await rt.record({ orgId: org.id, actor: caller, action: applied.action, at: now, details: applied.data, event: { type: "org.updated", data: applied.data } });
          }
          const [output] = await reportOutputs(rt, [resolved]);
          return output;
        });
      },
    },
  };
};
