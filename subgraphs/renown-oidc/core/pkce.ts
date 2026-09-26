import { constantTimeEqual, sha256B64url } from "./crypto.js";

const CODE_VERIFIER_RE = /^[A-Za-z0-9._~-]{43,128}$/;

/** RFC 7636 `S256` PKCE verification: `BASE64URL(SHA256(verifier)) === challenge`. */
export async function verifyPkceS256(verifier: string, challenge: string): Promise<boolean> {
  if (!CODE_VERIFIER_RE.test(verifier)) return false;
  return constantTimeEqual(await sha256B64url(verifier), challenge);
}
