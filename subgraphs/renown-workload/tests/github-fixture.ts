import {
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JSONWebKeySet,
  type JWTPayload,
} from "jose";
import { GITHUB_OIDC_ISSUER, WORKLOAD_OIDC_AUDIENCE } from "../core/github.js";

type RsaKeys = Awaited<ReturnType<typeof generateKeyPair>>;

let github: Promise<RsaKeys> | undefined;
let impostor: Promise<RsaKeys> | undefined;

/** The RSA key standing in for GitHub's (generated once per file; RSA keygen is slow). */
const githubKeys = () =>
  (github ??= generateKeyPair("RS256", { extractable: true }));
/** A key GitHub's JWKS doesn't contain, published under GitHub's `kid`. */
const impostorKeys = () =>
  (impostor ??= generateKeyPair("RS256", { extractable: true }));

export const GITHUB_KID = "gh-test-1";

/** The JWKS GitHub would serve: only the test key's public half. */
export async function githubJwks(): Promise<JSONWebKeySet> {
  const { publicKey } = await githubKeys();
  return {
    keys: [
      {
        ...(await exportJWK(publicKey)),
        kid: GITHUB_KID,
        alg: "RS256",
        use: "sig",
      },
    ],
  };
}

export const REPOSITORY_ID = "123456789";
export const REPOSITORY = "Acme/Shop";

/** The claims of a GitHub Actions OIDC token for a pull request run. */
export function prClaims(overrides: JWTPayload = {}): JWTPayload {
  return {
    repository: REPOSITORY,
    repository_id: REPOSITORY_ID,
    repository_owner: "Acme",
    ref: "refs/pull/42/merge",
    sha: "0123456789abcdef0123456789abcdef01234567",
    run_id: "9876543210",
    run_attempt: "1",
    actor: "octocat",
    event_name: "pull_request",
    ...overrides,
  };
}

export interface GithubTokenOptions {
  issuer?: string;
  audience?: string;
  /** Seconds from now; negative = already expired. */
  expiresIn?: number;
  /** Sign with a key GitHub never published. */
  forged?: boolean;
  now?: Date;
}

/** Signs a GitHub-style OIDC token (RS256) with the test key. */
export async function githubToken(
  claims: JWTPayload,
  options: GithubTokenOptions = {},
): Promise<string> {
  const { privateKey } = await (options.forged ? impostorKeys() : githubKeys());
  const nowSec = Math.floor((options.now ?? new Date()).getTime() / 1000);
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: GITHUB_KID, typ: "JWT" })
    .setIssuer(options.issuer ?? GITHUB_OIDC_ISSUER)
    .setAudience(options.audience ?? WORKLOAD_OIDC_AUDIENCE)
    .setSubject(`repo:${REPOSITORY}:pull_request`)
    .setIssuedAt(nowSec - 5)
    .setNotBefore(nowSec - 5)
    .setExpirationTime(nowSec + (options.expiresIn ?? 300))
    .sign(privateKey);
}
