import {
  createLocalJWKSet,
  errors,
  jwtVerify,
  type JSONWebKeySet,
  type JWTPayload,
} from "jose";

export const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
export const GITHUB_JWKS_URL = `${GITHUB_OIDC_ISSUER}/.well-known/jwks`;
/** The audience CI requests for its GitHub OIDC token (`core.getIDToken(aud)`). */
export const WORKLOAD_OIDC_AUDIENCE = "https://renown.vetra.io";

const JWKS_CACHE_MS = 3600_000;
/** An unknown `kid` refetches the JWKS (GitHub key rotation), at most this often. */
const JWKS_MIN_REFETCH_MS = 60_000;
const JWKS_FETCH_TIMEOUT_MS = 5_000;
const CLOCK_TOLERANCE_SEC = 30;

export type JwksFetcher = () => Promise<JSONWebKeySet>;

/** The GitHub Actions OIDC claims this exchange relies on. */
export interface GithubOidcClaims extends JWTPayload {
  repository: string;
  repository_id: string;
  ref: string;
  sha?: string;
  run_id?: string;
  run_attempt?: string;
  actor?: string;
}

export class GithubTokenError extends Error {
  constructor(
    message: string,
    /** `invalid`: the token is not acceptable; `unavailable`: GitHub's JWKS could not be fetched. */
    public readonly kind: "invalid" | "unavailable",
  ) {
    super(message);
    this.name = "GithubTokenError";
  }
}

/** Fetches GitHub's Actions OIDC JWKS. */
export const fetchGithubJwks: JwksFetcher = async () => {
  const res = await fetch(GITHUB_JWKS_URL, {
    signal: AbortSignal.timeout(JWKS_FETCH_TIMEOUT_MS),
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`JWKS fetch failed with HTTP ${res.status}`);
  const body = (await res.json()) as unknown;
  if (
    typeof body !== "object" ||
    body === null ||
    !Array.isArray((body as { keys?: unknown }).keys)
  ) {
    throw new Error("JWKS response is not a key set");
  }
  return body as JSONWebKeySet;
};

function optionalString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return undefined;
}

export interface GithubVerifierOptions {
  fetchJwks?: JwksFetcher;
  now?: () => Date;
}

/**
 * Verifies GitHub Actions OIDC tokens: RS256 against GitHub's JWKS (cached for
 * an hour), `iss`, `aud` = `https://renown.vetra.io`, `exp`/`nbf`, and the
 * presence of the repository and ref claims.
 */
export function createGithubVerifier(options: GithubVerifierOptions = {}) {
  const fetchJwks = options.fetchJwks ?? fetchGithubJwks;
  const now = options.now ?? (() => new Date());
  let cached: { jwks: JSONWebKeySet; fetchedAt: number } | undefined;
  let inflight: Promise<JSONWebKeySet> | undefined;

  async function load(force: boolean): Promise<JSONWebKeySet> {
    const at = now().getTime();
    if (!force && cached && at - cached.fetchedAt < JWKS_CACHE_MS) {
      return cached.jwks;
    }
    inflight ??= fetchJwks()
      .then((jwks) => {
        cached = { jwks, fetchedAt: now().getTime() };
        return jwks;
      })
      .finally(() => {
        inflight = undefined;
      });
    try {
      return await inflight;
    } catch (error) {
      // A stale key set beats none when GitHub is briefly unreachable.
      if (cached) return cached.jwks;
      const reason = error instanceof Error ? error.message : "unknown error";
      throw new GithubTokenError(
        `GitHub JWKS unavailable: ${reason}`,
        "unavailable",
      );
    }
  }

  async function verifyWith(token: string, jwks: JSONWebKeySet) {
    return jwtVerify(token, createLocalJWKSet(jwks), {
      issuer: GITHUB_OIDC_ISSUER,
      audience: WORKLOAD_OIDC_AUDIENCE,
      algorithms: ["RS256"],
      currentDate: now(),
      clockTolerance: CLOCK_TOLERANCE_SEC,
      requiredClaims: ["exp"],
    });
  }

  return {
    async verify(token: string): Promise<GithubOidcClaims> {
      let payload: JWTPayload;
      try {
        try {
          ({ payload } = await verifyWith(token, await load(false)));
        } catch (error) {
          const canRefetch =
            error instanceof errors.JWKSNoMatchingKey &&
            cached !== undefined &&
            now().getTime() - cached.fetchedAt >= JWKS_MIN_REFETCH_MS;
          if (!canRefetch) throw error;
          ({ payload } = await verifyWith(token, await load(true)));
        }
      } catch (error) {
        if (error instanceof GithubTokenError) throw error;
        const reason = error instanceof Error ? error.message : "unknown error";
        throw new GithubTokenError(reason, "invalid");
      }

      const repository = optionalString(payload.repository);
      const repositoryId = optionalString(payload.repository_id);
      const ref = optionalString(payload.ref);
      if (!repository || !repositoryId || !ref) {
        throw new GithubTokenError(
          "Token lacks repository, repository_id or ref",
          "invalid",
        );
      }
      return {
        ...payload,
        repository,
        repository_id: repositoryId,
        ref,
        sha: optionalString(payload.sha),
        run_id: optionalString(payload.run_id),
        run_attempt: optionalString(payload.run_attempt),
        actor: optionalString(payload.actor),
      };
    },
  };
}

export type GithubVerifier = ReturnType<typeof createGithubVerifier>;
