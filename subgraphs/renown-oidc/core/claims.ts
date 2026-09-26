import { getAddress } from "viem";

import type { OidcClient, Profile } from "./types.js";

/** An OIDC-provider-level error: `code` is the OAuth/OIDC error code, `status` the HTTP status a handler should respond with. */
export class OidcError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "OidcError";
  }
}

/** `did:pkh:eip155:<chainId>:<EIP-55 checksummed address>`. */
export function subjectFor(address: string, chainId: number): string {
  return `did:pkh:eip155:${chainId}:${getAddress(address)}`;
}

/**
 * Reduces a plain address or a `did:pkh:...:<address>` to a lowercase
 * address, so allow-list entries and lookups compare the same way
 * regardless of which shape either side is stored in.
 */
function normalizedSubjectAddress(value: string): string {
  const trailing = value.includes(":") ? value.slice(value.lastIndexOf(":") + 1) : value;
  return trailing.toLowerCase();
}

export function isSubjectAllowed(client: OidcClient, address: string): boolean {
  if (client.allowAnySubject) return true;
  const target = normalizedSubjectAddress(address);
  return client.allowedSubjects.some((subject) => normalizedSubjectAddress(subject) === target);
}

export function buildClaims(
  address: string,
  chainId: number,
  profile: Profile | undefined,
  scope: string,
): Record<string, unknown> {
  const scopes = new Set(scope.split(/\s+/).filter(Boolean));
  const claims: Record<string, unknown> = { sub: subjectFor(address, chainId) };

  if (scopes.has("profile")) {
    const shortAddress = `${address.slice(0, 6)}…${address.slice(-4)}`;
    const displayName = profile?.username ?? shortAddress;
    claims.name = displayName;
    claims.preferred_username = displayName;
    if (profile?.userImage) {
      claims.picture = profile.userImage;
    }
  }

  if (scopes.has("email")) {
    claims.email = `${address.toLowerCase()}@renown.vetra.io`;
    claims.email_verified = false;
  }

  return claims;
}
