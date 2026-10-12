import type { SigningKeys } from "../core/keys.js";
import type { OidcClient, OidcConfig, OrgClaim, Profile } from "../core/types.js";
import type { OidcStore } from "../store/types.js";

/** Looks up registered OIDC clients by `client_id` in the `oidc_clients` table. */
export interface ClientDirectory {
  getClient(clientId: string): Promise<OidcClient | undefined>;
}

/** Looks up a Renown profile by (lowercase or checksummed) Ethereum address. */
export interface ProfileDirectory {
  getProfile(address: string): Promise<Profile | undefined>;
}

/** The subject's organization memberships for the `orgs` claim and allowedOrgs. */
export interface OrgDirectory {
  orgsOf(address: string): Promise<OrgClaim[]>;
}

/** Which organisation (if any) owns a client, and whether that organisation is live (neither archived nor taken down). */
export interface OrgClientOwners {
  ownerOf(clientId: string): Promise<{ orgId: string; live: boolean } | undefined>;
}

export interface OidcDeps {
  config: OidcConfig;
  keys: SigningKeys;
  store: OidcStore;
  clients: ClientDirectory;
  profiles: ProfileDirectory;
  orgs?: OrgDirectory;
  now(): Date;
}
