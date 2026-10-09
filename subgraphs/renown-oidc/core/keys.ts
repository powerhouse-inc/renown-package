import { importJWK, SignJWT } from "jose";

export interface SigningKeys {
  sign(claims: Record<string, unknown>, opts: { audience: string; expiresInSec: number }): Promise<string>;
  jwks(): { keys: Record<string, unknown>[] };
}

const RSA_PRIVATE_FIELDS = ["n", "e", "d", "p", "q", "dp", "dq", "qi", "kid"] as const;
const MIN_MODULUS_BITS = 2048;

/** A parsed `RENOWN_OIDC_SIGNING_KEYS` entry: an RSA private JWK (with CRT parameters) and a `kid`. */
type RsaPrivateSigningJwk = { kty: "RSA" } & Record<(typeof RSA_PRIVATE_FIELDS)[number], string>;

function isRsaPrivateSigningJwk(value: unknown): value is RsaPrivateSigningJwk {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.kty === "RSA" && RSA_PRIVATE_FIELDS.every((field) => typeof v[field] === "string" && v[field] !== "");
}

/** The bit length of a base64url-encoded big-endian modulus (leading zero bits excluded). */
function modulusBits(n: string): number {
  const binary = atob(n.replace(/-/g, "+").replace(/_/g, "/"));
  let i = 0;
  while (i < binary.length && binary.charCodeAt(i) === 0) i++;
  if (i === binary.length) return 0;
  return (binary.length - i - 1) * 8 + (32 - Math.clz32(binary.charCodeAt(i)));
}

interface LoadedKey {
  kid: string;
  privateKey: Awaited<ReturnType<typeof importJWK<RsaPrivateSigningJwk>>>;
  publicJwk: Record<string, unknown>;
}

/**
 * Parses `RENOWN_OIDC_SIGNING_KEYS` (a JSON array of RSA private JWKs of at
 * least 2048 bits, each with a `kid`) into RS256 signing/JWKS operations.
 * RS256 because it is the one algorithm every OIDC relying party must
 * support. Returns `null` when unset (or empty), so callers can treat the
 * OIDC provider as disabled. Throws when the value is set but malformed
 * (not RSA, missing private or CRT parameters or `kid`, or too short); the
 * error never contains key material.
 */
export async function loadSigningKeys(raw: string | undefined, issuer: string): Promise<SigningKeys | null> {
  if (raw === undefined || raw.length === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Never echo the raw value: it's key material.
    throw new Error("RENOWN_OIDC_SIGNING_KEYS is not valid JSON");
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("RENOWN_OIDC_SIGNING_KEYS must be a non-empty JSON array of JWKs");
  }

  const keys: LoadedKey[] = await Promise.all(
    parsed.map(async (entry): Promise<LoadedKey> => {
      if (!isRsaPrivateSigningJwk(entry)) {
        throw new Error(
          "RENOWN_OIDC_SIGNING_KEYS entries must be RSA private JWKs (n, e, d, p, q, dp, dq, qi) with a 'kid'",
        );
      }
      let bits: number;
      try {
        bits = modulusBits(entry.n);
      } catch {
        throw new Error("RENOWN_OIDC_SIGNING_KEYS entry has a malformed modulus");
      }
      if (bits < MIN_MODULUS_BITS) {
        throw new Error(`RENOWN_OIDC_SIGNING_KEYS entries must have a modulus of at least ${MIN_MODULUS_BITS} bits`);
      }
      let privateKey: LoadedKey["privateKey"];
      try {
        privateKey = await importJWK(entry, "RS256");
      } catch {
        throw new Error(`RENOWN_OIDC_SIGNING_KEYS entry '${entry.kid}' is not a usable RSA private key`);
      }
      // Publish only the standard RSA public-key fields: copying every
      // remaining private-JWK field (e.g. a WebCrypto export's
      // `key_ops`/`ext`) produces a JWKS entry that jose's own `importJWK`
      // refuses, breaking every RP that verifies against it.
      const publicJwk = { kty: "RSA", n: entry.n, e: entry.e, kid: entry.kid, alg: "RS256", use: "sig" };
      return { kid: entry.kid, privateKey, publicJwk };
    }),
  );

  return {
    async sign(claims, opts) {
      const key = keys[0];
      return new SignJWT(claims)
        .setProtectedHeader({ alg: "RS256", kid: key.kid, typ: "JWT" })
        .setIssuer(issuer)
        .setAudience(opts.audience)
        .setIssuedAt()
        .setExpirationTime(`${opts.expiresInSec}s`)
        .sign(key.privateKey);
    },
    jwks() {
      return { keys: keys.map((key) => key.publicJwk) };
    },
  };
}
