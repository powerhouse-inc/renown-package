/**
 * Renown organisations: framework-free helpers shared by renown-package (the
 * renown-orgs subgraph), renown.id and Vetra. No imports; WebCrypto only, so
 * it runs in browsers and Node 20+.
 */

/** Organisation roles, highest first. */
export const ORG_ROLES = ["OWNER", "ADMIN", "PUBLISHER", "MEMBER"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

const RANK: Record<OrgRole, number> = { MEMBER: 0, PUBLISHER: 1, ADMIN: 2, OWNER: 3 };

/** The role named by `value` (any case, trimmed), or null. */
export function parseOrgRole(value: string): OrgRole | null {
  const upper = value.trim().toUpperCase();
  return Object.hasOwn(RANK, upper) ? (upper as OrgRole) : null;
}

/** True when `role` is `min` or higher; unknown roles never qualify. */
export function roleAtLeast(role: string, min: string): boolean {
  const have = parseOrgRole(role);
  const need = parseOrgRole(min);
  return have !== null && need !== null && RANK[have] >= RANK[need];
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => (item === undefined ? null : sortKeys(item)));
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (record[key] !== undefined) out[key] = sortKeys(record[key]);
    }
    return out;
  }
  return value;
}

/** JSON with object keys sorted recursively, no whitespace, undefined dropped and null kept. */
export function canonicalJson(value: unknown): string {
  const json = JSON.stringify(sortKeys(value)) as string | undefined;
  return json ?? "null";
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The message a wallet personal_signs to authorise a renown-orgs field
 * (mutation, or a query that needs a caller) without a bearer:
 *   Renown organization <field> <orgId or -> <sha256 hex of canonicalJson(args)> at <timestamp>
 * `args` are the field's arguments exactly as sent; `auth` and `orgId` are
 * dropped from them before hashing. `timestamp`: ISO-8601 with a zone,
 * within 10 minutes of the server's clock.
 */
export async function orgMessage(
  mutation: string,
  orgId: string | null | undefined,
  args: Record<string, unknown>,
  timestamp: string,
): Promise<string> {
  const { auth: _auth, orgId: _orgId, ...rest } = args;
  return `Renown organization ${mutation} ${orgId || "-"} ${await sha256Hex(canonicalJson(rest))} at ${timestamp}`;
}

/** One entry of the OIDC `orgs` claim (an ACTIVE membership of a live organisation). */
export interface OrgClaim {
  id: string;
  /** did:web:<host>:org:<id> */
  did: string;
  handle: string;
  name: string;
  role: OrgRole;
  /** Team slugs. */
  teams: string[];
  verifiedDomains: string[];
}

/**
 * Release attestations: an EIP-712 `ReleaseAttestation` signed by a publisher
 * of the app (the personal publisher, or a covered PUBLISHER+ of the owning
 * organisation). renown-orgs `attestRelease`, renown.id `/verify` and SDK
 * users all sign and verify with exactly these constants.
 */
export const RELEASE_DOMAIN = { name: "Renown Release", version: "1", chainId: 1 } as const;

export const RELEASE_PRIMARY_TYPE = "ReleaseAttestation" as const;

export const RELEASE_TYPES = {
  ReleaseAttestation: [
    { name: "appDid", type: "string" },
    { name: "version", type: "string" },
    { name: "artifactDigest", type: "string" },
    { name: "orgId", type: "string" },
    { name: "issuedAt", type: "string" },
  ],
} as const;

/** A type alias (not an interface) so it fits viem's Record-typed messages. */
export type ReleaseMessage = {
  /** The app's did:key. */
  appDid: string;
  version: string;
  /** sha256:<64 lowercase hex> */
  artifactDigest: string;
  /** The owning organisation's id; "" for person-owned apps. */
  orgId: string;
  /** ISO-8601 with a zone (e.g. 2026-10-12T12:00:00.000Z); renown-orgs stores and returns it byte for byte. */
  issuedAt: string;
};

/** The typed data a wallet signs (eth_signTypedData_v4) for `message`. */
export function releaseTypedData(message: ReleaseMessage) {
  return { domain: RELEASE_DOMAIN, types: RELEASE_TYPES, primaryType: RELEASE_PRIMARY_TYPE, message };
}

/** The header renown-orgs signs webhook deliveries with. */
export const ORG_WEBHOOK_SIGNATURE_HEADER = "Renown-Signature";

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** The well-formed entries of an ID token's (or userinfo's) `orgs` claim, roles uppercased; [] for anything else. */
export function orgsFromClaims(claims: unknown): OrgClaim[] {
  const orgs = (claims as { orgs?: unknown } | null | undefined)?.orgs;
  if (!Array.isArray(orgs)) return [];
  return orgs.flatMap((entry: unknown): OrgClaim[] => {
    if (!entry || typeof entry !== "object") return [];
    const org = entry as Record<string, unknown>;
    const role = typeof org.role === "string" ? parseOrgRole(org.role) : null;
    if (typeof org.id !== "string" || typeof org.did !== "string" || typeof org.handle !== "string" || typeof org.name !== "string" || !role) {
      return [];
    }
    return [{ id: org.id, did: org.did, handle: org.handle, name: org.name, role, teams: strings(org.teams), verifiedDomains: strings(org.verifiedDomains) }];
  });
}

/** True when the claims list the organisation (by id, or by handle case-insensitively) with at least `minRole`. */
export function hasOrgRole(claims: unknown, orgIdOrHandle: string, minRole: string): boolean {
  const wanted = orgIdOrHandle.trim();
  const handle = wanted.toLowerCase();
  return orgsFromClaims(claims).some(
    (org) => (org.id === wanted || org.handle.toLowerCase() === handle) && roleAtLeast(org.role, minRole),
  );
}

function hexOf(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Constant-time comparison of two equal-purpose hex strings. */
function equalHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verifies a renown-orgs webhook delivery. `header` is the Renown-Signature
 * value `t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<rawBody>")>` (one
 * or more v1 values, any may match); the timestamp must be within
 * `toleranceSec` of now. Pass the raw request body, before JSON parsing.
 * Malformed headers return false.
 */
export async function verifyWebhookSignature(
  secret: string,
  header: string | null | undefined,
  rawBody: string,
  toleranceSec = 300,
  nowMs: number = Date.now(),
): Promise<boolean> {
  if (!header) return false;
  let t: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [key, value] = part.trim().split("=", 2);
    if (key === "t" && value && /^\d+$/.test(value)) t = Number(value);
    else if (key === "v1" && value && /^[0-9a-f]{64}$/.test(value)) signatures.push(value);
  }
  if (t === null || signatures.length === 0) return false;
  if (Math.abs(nowMs / 1000 - t) > toleranceSec) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = hexOf(await crypto.subtle.sign("HMAC", key, encoder.encode(`${t}.${rawBody}`)));
  let ok = false;
  for (const signature of signatures) ok = equalHex(signature, expected) || ok;
  return ok;
}

/** What orgMembership answers for an ACTIVE membership. */
export interface OrgMembershipView {
  orgId: string;
  address: string;
  role: OrgRole;
  status: string;
  appScope: { all: boolean; appDids: string[] };
  effectiveScope: { all: boolean; appDids: string[] };
  teams: string[];
}

const MEMBERSHIP_QUERY = `query OrgMembership($orgId: String!, $address: String!) {
  orgMembership(orgId: $orgId, address: $address) {
    orgId address role status appScope { all appDids } effectiveScope { all appDids } teams
  }
}`;

/**
 * The membership of `address` in `orgId` from a renown-orgs GraphQL endpoint
 * (e.g. https://switchboard.renown.vetra.io/graphql/renown-orgs), or null when
 * there is none. Throws on HTTP, GraphQL, network or timeout errors (default
 * 10 s) so callers can fail closed.
 */
export async function fetchOrgMembership(
  endpoint: string,
  orgId: string,
  address: string,
  options: { fetch?: typeof fetch; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<OrgMembershipView | null> {
  const doFetch = options.fetch ?? fetch;
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 10_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const response = await doFetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: MEMBERSHIP_QUERY, variables: { orgId, address } }),
    signal,
  });
  if (!response.ok) throw new Error(`renown-orgs answered HTTP ${response.status}`);
  const result = (await response.json()) as { data?: { orgMembership?: OrgMembershipView | null }; errors?: { message: string }[] };
  if (result.errors?.length) throw new Error(result.errors.map((error) => error.message).join("; "));
  return result.data?.orgMembership ?? null;
}
