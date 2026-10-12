import { orgMessage } from "../../../sdk/orgs.js";
import { isFreshTimestamp, verifySignedMessage } from "../../renown-auth/core/signed-message.js";
import { verifyMessageOnChain } from "../../renown-auth/core/smart-wallet.js";
import { forbidden } from "./errors.js";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
// Org messages carry no chain; smart-wallet signatures are checked on chain 1.
const MESSAGE_CHAIN_ID = 1;

/** A personal_sign over orgMessage(field, orgId, args, timestamp). */
export interface OrgAuthInput {
  address: string;
  signature: string;
  timestamp: string;
}

/** The host's resolver context: `user` is set only when the host resolved a bearer. */
export interface OrgContext {
  user?: { address?: string; appKey?: string };
  headers?: Record<string, string | string[] | undefined>;
}

export type OrgArgs = Record<string, unknown> & { auth?: OrgAuthInput | null };

/**
 * The lowercase address the caller proves, or null when they prove none.
 * A present `auth` is always verified (EOA offline, then ERC-1271/6492 on
 * chain 1) and never falls back to the bearer: a wrong one is FORBIDDEN.
 * Without `auth`, the host-resolved bearer's address.
 */
export async function provenAddress(
  ctx: OrgContext,
  field: string,
  args: OrgArgs,
  now: Date,
): Promise<string | null> {
  const auth = args.auth;
  if (auth) {
    if (!ADDRESS_RE.test(auth.address) || !isFreshTimestamp(auth.timestamp, now)) throw forbidden();
    const orgId = typeof args.orgId === "string" ? args.orgId : null;
    const message = await orgMessage(field, orgId, args, auth.timestamp);
    const address = auth.address.toLowerCase();
    const signed =
      (await verifySignedMessage({ address, message, signature: auth.signature })) ||
      (await verifyMessageOnChain({ chainId: MESSAGE_CHAIN_ID, address, message, signature: auth.signature }));
    if (!signed) throw forbidden();
    return address;
  }
  const bearer = ctx.user?.address;
  return bearer && ADDRESS_RE.test(bearer) ? bearer.toLowerCase() : null;
}

/** provenAddress, but FORBIDDEN when the caller proves nothing. */
export async function requireAddress(ctx: OrgContext, field: string, args: OrgArgs, now: Date): Promise<string> {
  const address = await provenAddress(ctx, field, args, now);
  if (address === null) throw forbidden();
  return address;
}
