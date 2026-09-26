import type { SigningKeys } from "../core/keys.js";
import type { OidcClient, OidcConfig, Profile } from "../core/types.js";
import type { OidcStore } from "../store/types.js";

/** Looks up registered OIDC clients by `client_id` in the `oidc_clients` table. */
export interface ClientDirectory {
  getClient(clientId: string): Promise<OidcClient | undefined>;
}

/** Looks up a Renown profile by (lowercase or checksummed) Ethereum address. */
export interface ProfileDirectory {
  getProfile(address: string): Promise<Profile | undefined>;
}

export interface OidcDeps {
  config: OidcConfig;
  keys: SigningKeys;
  store: OidcStore;
  clients: ClientDirectory;
  profiles: ProfileDirectory;
  now(): Date;
}
