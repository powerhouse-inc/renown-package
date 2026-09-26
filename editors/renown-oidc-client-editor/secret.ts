import {
  randomToken,
  hashSecret,
} from "../../subgraphs/renown-oidc/core/crypto.js";

/**
 * Generates a new OIDC client secret: a 256-bit random token in plaintext,
 * and its sha256 hash for storage on the document. The plaintext is only
 * ever returned here — callers must show it once and never persist it.
 */
export async function generateClientSecret(): Promise<{
  secret: string;
  hash: string;
}> {
  const secret = randomToken(32);
  const hash = await hashSecret(secret);
  return { secret, hash };
}
