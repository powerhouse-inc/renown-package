import { verifyMessage } from "viem";
import { parseSiweMessage } from "viem/siwe";

import { OidcError } from "./claims.js";
import type { LoginRequest, OidcClient, OidcConfig } from "./types.js";

export interface SiweTemplate {
  domain: string;
  uri: string;
  version: "1";
  nonce: string;
  issuedAt: string;
  expirationTime: string;
  statement: string;
  requestId: string;
  resources: string[];
}

/** The SIWE message fields the login request binds the user to sign. */
export function buildSiweTemplate(req: LoginRequest, client: OidcClient, cfg: OidcConfig, now: Date): SiweTemplate {
  return {
    domain: new URL(cfg.loginUrl).host,
    uri: cfg.issuer,
    version: "1",
    nonce: req.siweNonce,
    issuedAt: now.toISOString(),
    expirationTime: req.expiresAt.toISOString(),
    statement: `Sign in to ${client.name.replace(/[\r\n]+/g, " ")} with Renown.`,
    requestId: req.id,
    resources: [`urn:renown-oidc:request:${req.id}`],
  };
}

/**
 * Verifies a signed SIWE message against the template the login request
 * expects: every binding field must match exactly, the message must not be
 * expired (and not outlive the request's own expiry), and the signature must
 * verify offline (EOA only). `issuedAt` is deliberately not compared — the
 * handler re-derives the template with a fresh `issuedAt` at verification
 * time. Throws `OidcError("invalid_request")` for a structurally incomplete
 * message and `OidcError("access_denied")` for anything that doesn't match
 * or fails to verify.
 */
export async function verifySiweLogin(
  message: string,
  signature: `0x${string}`,
  expected: SiweTemplate,
  now: Date,
): Promise<{ address: `0x${string}`; chainId: number }> {
  const parsed = parseSiweMessage(message);

  if (!parsed.address || parsed.chainId === undefined) {
    throw new OidcError("invalid_request", "SIWE message is missing an address or chain id");
  }
  if (parsed.version !== "1") {
    throw new OidcError("invalid_request", "SIWE message has an unsupported version");
  }
  if (!parsed.expirationTime) {
    throw new OidcError("invalid_request", "SIWE message has no expiration time");
  }

  if (parsed.domain !== expected.domain) {
    throw new OidcError("access_denied", "SIWE domain does not match the login request", 403);
  }
  if (parsed.uri !== expected.uri) {
    throw new OidcError("access_denied", "SIWE uri does not match the login request", 403);
  }
  if (parsed.nonce !== expected.nonce) {
    throw new OidcError("access_denied", "SIWE nonce does not match the login request", 403);
  }
  if (parsed.requestId !== expected.requestId) {
    throw new OidcError("access_denied", "SIWE request id does not match the login request", 403);
  }
  if (!(parsed.expirationTime.getTime() > now.getTime())) {
    throw new OidcError("access_denied", "SIWE message has expired", 403);
  }
  if (!(parsed.expirationTime.getTime() <= new Date(expected.expirationTime).getTime())) {
    throw new OidcError("access_denied", "SIWE expiration exceeds the login request's own expiry", 403);
  }

  const { address, chainId } = parsed;
  const verified = await verifyMessage({ address, message, signature });
  if (!verified) {
    throw new OidcError("access_denied", "SIWE signature is invalid", 403);
  }

  return { address, chainId };
}
