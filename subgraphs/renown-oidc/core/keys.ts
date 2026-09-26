import { importJWK, SignJWT } from "jose";

export interface SigningKeys {
  sign(claims: Record<string, unknown>, opts: { audience: string; expiresInSec: number }): Promise<string>;
  jwks(): { keys: Record<string, unknown>[] };
}

/** A parsed `RENOWN_OIDC_SIGNING_KEYS` entry: an EC P-256 private JWK with a `kid`. */
interface EcPrivateSigningJwk {
  kty: "EC";
  crv: "P-256";
  d: string;
  kid: string;
  x: string;
  y: string;
}

function isEcPrivateSigningJwk(value: unknown): value is EcPrivateSigningJwk {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.kty === "EC" &&
    v.crv === "P-256" &&
    typeof v.d === "string" &&
    typeof v.kid === "string" &&
    typeof v.x === "string" &&
    typeof v.y === "string"
  );
}

interface LoadedKey {
  kid: string;
  privateKey: Awaited<ReturnType<typeof importJWK<EcPrivateSigningJwk>>>;
  publicJwk: Record<string, unknown>;
}

/**
 * Parses `RENOWN_OIDC_SIGNING_KEYS` (a JSON array of EC P-256 private JWKs,
 * each with a `kid`) into signing/JWKS operations. Returns `null` when unset
 * (or empty), so callers can treat the OIDC provider as disabled. Throws when
 * the value is set but malformed (not EC P-256, or missing `d`/`kid`).
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
      if (!isEcPrivateSigningJwk(entry)) {
        throw new Error("RENOWN_OIDC_SIGNING_KEYS entries must be EC P-256 private JWKs with a 'kid'");
      }
      const privateKey = await importJWK(entry, "ES256");
      // Publish only the standard EC public-key fields: copying every
      // remaining private-JWK field (e.g. a WebCrypto export's
      // `key_ops`/`ext`) produces a JWKS entry that jose's own `importJWK`
      // refuses ("Unsupported key usage for a ECDSA key"), breaking every
      // RP that verifies against it.
      const publicJwk = {
        kty: entry.kty,
        crv: entry.crv,
        x: entry.x,
        y: entry.y,
        kid: entry.kid,
        alg: "ES256",
        use: "sig",
      };
      return { kid: entry.kid, privateKey, publicJwk };
    }),
  );

  return {
    async sign(claims, opts) {
      const key = keys[0];
      return new SignJWT(claims)
        .setProtectedHeader({ alg: "ES256", kid: key.kid, typ: "JWT" })
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
