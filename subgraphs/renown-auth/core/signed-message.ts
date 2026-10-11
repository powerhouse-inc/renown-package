import { verifyMessage } from "viem";

// Signed actions (revoke, profile update) must carry a timestamp within this
// window of the server's clock, in either direction. Signing a fresh message
// and replaying an old one both fail outside this bound.
export const SIGNATURE_WINDOW_MS = 600_000;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return toHex(new Uint8Array(digest));
}

/** Canonical message a caller signs to authorize revoking `credentialId`. */
export function revokeMessage(credentialId: string, timestamp: string): string {
  return `Revoke Renown credential ${credentialId} at ${timestamp}`;
}

/** A profile link as signed and stored. */
export interface ProfileLink {
  id: string;
  label: string;
  url: string;
}

/** Every field a signed profile upsert may carry. Absent and null mean "unchanged". */
export interface ProfileFields {
  username?: string | null;
  userImage?: string | null;
  displayName?: string | null;
  handle?: string | null;
  bio?: string | null;
  links?: readonly ProfileLink[] | null;
  avatar?: string | null;
  /** People-search opt-in. */
  listed?: boolean | null;
}

/**
 * The JSON a profile signature hashes. If every one of displayName, handle,
 * bio, links, avatar and listed is null/undefined, the payload is the legacy
 * two-key `{username, userImage}` that older clients sign. Otherwise the seven
 * keys username, userImage, displayName, handle, bio, links, avatar are hashed
 * in that fixed order (each link reduced to `{id, label, url}` in that key
 * order), followed by `listed` as an eighth key only when it is a boolean.
 * `listed` counts as an identity field, so a listed-only payload uses the
 * seven-key form plus `listed`; `listed: null` behaves exactly like absent,
 * leaving every payload without a boolean `listed` unchanged. The client and
 * the server serialize the same bytes.
 */
export function profilePayload(profile: ProfileFields): string {
  const legacy = { username: profile.username ?? null, userImage: profile.userImage ?? null };
  const listed = profile.listed ?? null;
  const identity = [profile.displayName, profile.handle, profile.bio, profile.links, profile.avatar, listed];
  if (identity.every((value) => value === undefined || value === null)) {
    return JSON.stringify(legacy);
  }
  return JSON.stringify({
    ...legacy,
    displayName: profile.displayName ?? null,
    handle: profile.handle ?? null,
    bio: profile.bio ?? null,
    links: profile.links ? profile.links.map(({ id, label, url }) => ({ id, label, url })) : null,
    avatar: profile.avatar ?? null,
    ...(listed === null ? {} : { listed }),
  });
}

/**
 * Canonical message a caller signs to authorize a profile upsert. The payload
 * is hashed (rather than embedded raw) so the signed message has a fixed
 * shape regardless of field content.
 */
export async function profileMessage(
  address: string,
  profile: ProfileFields,
  timestamp: string,
): Promise<string> {
  const hash = await sha256hex(profilePayload(profile));
  return `Update Renown profile ${address.toLowerCase()} ${hash} at ${timestamp}`;
}

// Full date + time + an explicit zone (`Z` or `±HH:MM`), no bare local-time
// strings. `Date.parse` alone accepts zone-less and date-only strings too
// (interpreting them ambiguously as local time), which a signed-timestamp
// freshness check must not.
const STRICT_ISO_8601_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** True when `timestamp` (strict ISO-8601, zone required) is within `SIGNATURE_WINDOW_MS` of `now`. */
export function isFreshTimestamp(timestamp: string, now: Date): boolean {
  if (!STRICT_ISO_8601_RE.test(timestamp)) return false;
  const t = Date.parse(timestamp);
  if (Number.isNaN(t)) return false;
  return Math.abs(now.getTime() - t) <= SIGNATURE_WINDOW_MS;
}

/**
 * Verifies an EIP-191 `personal_sign` signature (viem `verifyMessage`,
 * offline, EOA only). Any failure — malformed signature, wrong address, a
 * throw from the underlying recovery — resolves to `false` rather than
 * rejecting.
 */
export async function verifySignedMessage(args: {
  address: string;
  message: string;
  signature: string;
}): Promise<boolean> {
  try {
    return await verifyMessage({
      address: args.address as `0x${string}`,
      message: args.message,
      signature: args.signature as `0x${string}`,
    });
  } catch {
    return false;
  }
}
