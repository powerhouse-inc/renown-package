import { getDomain, getDomainWithoutSuffix } from "tldts";
import type { GraphQLError } from "graphql";
import { handleProblem, normalizeHandle } from "../../renown-auth/core/handle.js";
import { findHandleOwner, type ReadModelDb } from "../../renown-auth/lookups.js";
import type { OrgStore, ReservedHandleRecord } from "../store/types.js";
import { badInput, orgError, unavailable } from "./errors.js";

export { normalizeHandle };

/** Route words of renown.id that only organizations may not take (user handles keep renown-auth's list). */
export const ORG_RESERVED_HANDLES: ReadonlySet<string> = new Set([
  "org", "orgs", "new", "invite", "invites", "notifications", "me", "verify", "people", "search",
]);

/** reserved_handles.reason of a handle a platform admin took away (RELEASE_HANDLE). */
export const RELEASED_REASON = "RELEASED";

export type OrgHandleProblem = "INVALID" | "RESERVED" | "TAKEN";

/**
 * Why the normalized `handle` cannot be (or stay) the handle of `orgId`, or
 * null when it can. Users and organizations share one namespace.
 */
export async function orgHandleProblem(
  deps: { store: OrgStore; relationalDb: ReadModelDb; now: Date },
  handle: string,
  orgId?: string,
): Promise<OrgHandleProblem | null> {
  const problem = handleProblem(handle);
  if (problem) return problem;
  if (ORG_RESERVED_HANDLES.has(handle)) return "RESERVED";
  const holder = await deps.store.organizationByHandle(handle);
  if (holder) return holder.id === orgId ? null : "TAKEN";
  const reserved = await deps.store.reservedHandle(handle, deps.now);
  if (reserved && (orgId === undefined || reserved.orgId !== orgId) && !(await claimsReleased(deps.store, reserved, orgId))) {
    return "RESERVED";
  }
  let userDocument: string | undefined;
  try {
    userDocument = await findHandleOwner(deps.relationalDb, handle);
  } catch {
    throw unavailable("Handles cannot be checked right now");
  }
  return userDocument === undefined ? null : "TAKEN";
}

/**
 * True when `domain` is exactly the registrable domain (eTLD+1, ICANN public
 * suffixes only) `<handle>.<public suffix>`: acme.com and acme.co.uk name
 * "acme"; sub.acme.com, acme.their-domain.com and acme.github.io do not.
 */
export function registrableDomainNames(domain: string, handle: string): boolean {
  return getDomain(domain) === domain && getDomainWithoutSuffix(domain) === handle;
}

/**
 * A handle released after a dispute (spec §3.11) may go, while it is still
 * reserved, to an organization with a VERIFIED registrable domain
 * `<handle>.<public suffix>` (domains are stored lowercase).
 */
async function claimsReleased(store: OrgStore, reserved: ReservedHandleRecord, orgId: string | undefined): Promise<boolean> {
  if (reserved.reason !== RELEASED_REASON || orgId === undefined) return false;
  return (await store.domains(orgId)).some((d) => d.status === "VERIFIED" && registrableDomainNames(d.domain, reserved.handle));
}

export function handleError(problem: OrgHandleProblem, handle: string): GraphQLError {
  if (problem === "INVALID") return badInput("handle", `"${handle}" is not a valid handle`);
  if (problem === "RESERVED") return orgError("HANDLE_RESERVED", `The handle "${handle}" is reserved`, "handle");
  return orgError("HANDLE_TAKEN", `The handle "${handle}" is taken`, "handle");
}
