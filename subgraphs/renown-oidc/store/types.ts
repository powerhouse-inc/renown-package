import type { Kysely } from "kysely";
import type { AccessToken, AuthCode, LoginRequest } from "../core/types.js";

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
  chain_id: number;
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

export interface OidcDB {
  login_requests: LoginRequestRow;
  auth_codes: AuthCodeRow;
  access_tokens: AccessTokenRow;
}

export interface OidcStore {
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
