import type { OidcConfig } from "./types.js";

const DEFAULT_LOGIN_URL = "https://renown.vetra.io/oidc/login";

function nonEmpty(value: string | undefined): string | undefined {
  return value !== undefined && value.length > 0 ? value : undefined;
}

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

/**
 * Builds the OIDC config from the environment, falling back to the http base
 * url (`<httpBaseUrl>/oidc`) for the issuer and to Renown's public login page
 * for the login url. Empty-string env values are treated as unset.
 */
export function loadConfig(env: Record<string, string | undefined>, httpBaseUrl: string): OidcConfig {
  const issuer = stripTrailingSlashes(nonEmpty(env.RENOWN_OIDC_ISSUER) ?? `${httpBaseUrl}/oidc`);
  const loginUrl = nonEmpty(env.RENOWN_OIDC_LOGIN_URL) ?? DEFAULT_LOGIN_URL;
  const registrationToken = nonEmpty(env.RENOWN_OIDC_REGISTRATION_TOKEN) ?? null;
  const driveId = nonEmpty(env.RENOWN_OIDC_DRIVE_ID) ?? null;
  return { issuer, loginUrl, registrationToken, driveId };
}
