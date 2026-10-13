import { beforeDeadline, FETCH_TIMEOUT_MS, guardedRequest, type NetDeps } from "./net.js";

const RECOVER_RE = /^renown-org-recover=(.+);owner=(0x[0-9a-fA-F]{40})$/;

/** How long a domain must have been VERIFIED before it can recover the organization (checked at start and at execution). */
export const RECOVERY_MIN_VERIFIED_DAYS = 14;

export function domainTxtName(domain: string): string {
  return `_renown.${domain}`;
}

export function domainTxtValue(orgId: string, token: string): string {
  return `renown-org=${orgId};token=${token}`;
}

export function wellKnownUrl(domain: string): string {
  return `https://${domain}/.well-known/renown.json`;
}

export function wellKnownJson(orgId: string, token: string): string {
  return JSON.stringify({ organizations: [{ id: orgId, token }] });
}

export function recoveryTxtValue(orgId: string, owner: string): string {
  return `renown-org-recover=${orgId};owner=${owner.toLowerCase()}`;
}

interface WellKnownEntry {
  id?: unknown;
  token?: unknown;
  recover?: unknown;
}

/** The TXT records at _renown.<domain>, each record's chunks joined; [] on any DNS failure. */
async function txtRecords(deps: NetDeps, domain: string, deadline: number): Promise<string[]> {
  try {
    return (await beforeDeadline(deps.resolveTxt(domainTxtName(domain)), deadline, "TXT lookup")).map((chunks) => chunks.join("").trim());
  } catch {
    return [];
  }
}

/** The organizations[] entries of renown.json; [] when it cannot be fetched or parsed. */
async function wellKnownEntries(deps: NetDeps, domain: string, deadline: number): Promise<WellKnownEntry[]> {
  try {
    const response = await guardedRequest(deps, wellKnownUrl(domain), { method: "GET", headers: { accept: "application/json" }, deadline });
    if (response.status !== 200) return [];
    const parsed = JSON.parse(new TextDecoder().decode(response.body)) as { organizations?: unknown };
    if (!Array.isArray(parsed.organizations)) return [];
    return parsed.organizations.filter((entry): entry is WellKnownEntry => entry !== null && typeof entry === "object");
  } catch {
    return [];
  }
}

/**
 * True when the domain publishes this organization's token (TXT, else
 * renown.json). One deadline (`timeoutMs`, 5 s) spans the whole attempt.
 */
export async function proveDomain(deps: NetDeps, domain: string, orgId: string, token: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  if ((await txtRecords(deps, domain, deadline)).includes(domainTxtValue(orgId, token))) return true;
  return (await wellKnownEntries(deps, domain, deadline)).some((entry) => entry.id === orgId && entry.token === token);
}

/**
 * True when the domain names `owner` as the recovery owner of this
 * organization (TXT, else renown.json). One deadline spans the whole attempt.
 */
export async function proveRecovery(deps: NetDeps, domain: string, orgId: string, owner: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const wanted = owner.toLowerCase();
  const viaTxt = (await txtRecords(deps, domain, deadline)).some((value) => {
    const match = RECOVER_RE.exec(value);
    return match !== null && match[1] === orgId && match[2].toLowerCase() === wanted;
  });
  if (viaTxt) return true;
  return (await wellKnownEntries(deps, domain, deadline)).some(
    (entry) => entry.id === orgId && typeof entry.recover === "string" && entry.recover.toLowerCase() === wanted,
  );
}
