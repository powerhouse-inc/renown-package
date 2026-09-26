import type { ColumnType, Kysely } from "kysely";
import type { AccessToken, AuthCode, LoginRequest, OidcClient } from "../core/types.js";

/** A `timestamptz` column: the driver returns a `Date`, but accepts either on write. */
export type Timestamp = Date | string;

export interface LoginRequestRow {
  id: string;
  client_id: string;
  redirect_uri: string;
  scope: string;
  state: string | null;
  nonce: string | null;
  code_challenge: string | null;
  siwe_nonce: string;
  expires_at: Timestamp;
}

export interface AuthCodeRow {
  code_hash: string;
  client_id: string;
  redirect_uri: string;
  sub: string;
  address: string;
  /** `bigint`: EIP-155 chain ids can exceed int4. Drivers return int8 as a string, bigint or number. */
  chain_id: ColumnType<string | number | bigint, number, number>;
  nonce: string | null;
  code_challenge: string | null;
  scope: string;
  auth_time: Timestamp;
  expires_at: Timestamp;
  used_at: Timestamp | null;
}

export interface AccessTokenRow {
  token_hash: string;
  code_hash: string;
  client_id: string;
  sub: string;
  address: string;
  scope: string;
  expires_at: Timestamp;
  revoked: boolean;
}

/**
 * A registered OIDC client. This table — not the mirrored `renown/oidc-client`
 * document — is the source of truth for sign-in: the renown switchboard's
 * access policy is open, so document state is audit-only.
 */
export interface OidcClientRow {
  client_id: string;
  name: string;
  /** JSON array of redirect URIs. */
  redirect_uris: string;
  /** JSON array of lowercase 0x addresses. */
  allowed_subjects: string;
  allow_any: ColumnType<boolean, boolean | undefined, boolean>;
  secret_hash: string | null;
  status: "ACTIVE" | "DISABLED";
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface OidcDB {
  oidc_clients: OidcClientRow;
  login_requests: LoginRequestRow;
  auth_codes: AuthCodeRow;
  access_tokens: AccessTokenRow;
}

/** The mutable fields of a client; `id` never changes. */
export type OidcClientPatch = Partial<Omit<OidcClient, "id">>;

export interface OidcStore {
  createClient(client: OidcClient, now: Date): Promise<void>;
  getClient(clientId: string): Promise<OidcClient | undefined>;
  /** Applies `patch` and returns the updated client, or undefined when it doesn't exist. */
  updateClient(clientId: string, patch: OidcClientPatch, now: Date): Promise<OidcClient | undefined>;
  createLoginRequest(r: LoginRequest): Promise<void>;
  getLoginRequest(id: string): Promise<LoginRequest | undefined>;
  deleteLoginRequest(id: string): Promise<void>;
  createAuthCode(c: AuthCode): Promise<void>;
  /** Atomically marks the code used. `firstUse` is false when it had already been used (replay). */
  consumeAuthCode(
    codeHash: string,
    now: Date,
  ): Promise<{ code: AuthCode; firstUse: boolean } | undefined>;
  createAccessToken(t: AccessToken): Promise<void>;
  getAccessToken(tokenHash: string): Promise<AccessToken | undefined>;
  revokeAccessTokensForCode(codeHash: string): Promise<void>;
  deleteExpired(now: Date): Promise<number>;
}

export type OidcKysely = Kysely<OidcDB>;
