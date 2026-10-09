import { exportJWK, generateKeyPair, type JWK } from "jose";

let cached: Promise<JWK> | undefined;

/** A 2048-bit RSA private JWK with `kid: "k1"`, generated once per test file (RSA keygen is slow). */
export function testSigningJwk(): Promise<JWK> {
  cached ??= generateKeyPair("RS256", { extractable: true, modulusLength: 2048 }).then(async ({ privateKey }) => ({
    ...(await exportJWK(privateKey)),
    kid: "k1",
  }));
  return cached;
}

/** `RENOWN_OIDC_SIGNING_KEYS` holding the test key. */
export async function testSigningKeysEnv(): Promise<string> {
  return JSON.stringify([await testSigningJwk()]);
}
