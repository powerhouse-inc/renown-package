import type { AccessToken, AuthCode, LoginRequest } from "../core/types.js";
import type {
  AccessTokenRow,
  AuthCodeRow,
  LoginRequestRow,
  OidcKysely,
  OidcStore,
} from "./types.js";

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function toLoginRequest(row: LoginRequestRow): LoginRequest {
  return {
    id: row.id,
    clientId: row.client_id,
    redirectUri: row.redirect_uri,
    scope: row.scope,
    state: row.state,
    nonce: row.nonce,
    codeChallenge: row.code_challenge,
    siweNonce: row.siwe_nonce,
    expiresAt: toDate(row.expires_at),
  };
}

function toAuthCode(row: AuthCodeRow): AuthCode {
  return {
    codeHash: row.code_hash,
    clientId: row.client_id,
    redirectUri: row.redirect_uri,
    sub: row.sub,
    address: row.address,
    chainId: row.chain_id,
    nonce: row.nonce,
    codeChallenge: row.code_challenge,
    scope: row.scope,
    authTime: toDate(row.auth_time),
    expiresAt: toDate(row.expires_at),
    usedAt: row.used_at === null ? null : toDate(row.used_at),
  };
}

function toAccessToken(row: AccessTokenRow): AccessToken {
  return {
    tokenHash: row.token_hash,
    codeHash: row.code_hash,
    clientId: row.client_id,
    sub: row.sub,
    address: row.address,
    scope: row.scope,
    expiresAt: toDate(row.expires_at),
    revoked: row.revoked,
  };
}

/** Kysely-backed `OidcStore`. The `db` passed in is already namespace-scoped. */
export class KyselyOidcStore implements OidcStore {
  constructor(private readonly db: OidcKysely) {}

  async createLoginRequest(r: LoginRequest): Promise<void> {
    await this.db
      .insertInto("login_requests")
      .values({
        id: r.id,
        client_id: r.clientId,
        redirect_uri: r.redirectUri,
        scope: r.scope,
        state: r.state,
        nonce: r.nonce,
        code_challenge: r.codeChallenge,
        siwe_nonce: r.siweNonce,
        expires_at: r.expiresAt,
      })
      .execute();
  }

  async getLoginRequest(id: string): Promise<LoginRequest | undefined> {
    const row = await this.db
      .selectFrom("login_requests")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    return row ? toLoginRequest(row) : undefined;
  }

  async deleteLoginRequest(id: string): Promise<void> {
    await this.db.deleteFrom("login_requests").where("id", "=", id).execute();
  }

  async createAuthCode(c: AuthCode): Promise<void> {
    await this.db
      .insertInto("auth_codes")
      .values({
        code_hash: c.codeHash,
        client_id: c.clientId,
        redirect_uri: c.redirectUri,
        sub: c.sub,
        address: c.address,
        chain_id: c.chainId,
        nonce: c.nonce,
        code_challenge: c.codeChallenge,
        scope: c.scope,
        auth_time: c.authTime,
        expires_at: c.expiresAt,
        used_at: c.usedAt,
      })
      .execute();
  }

  async consumeAuthCode(
    codeHash: string,
    now: Date,
  ): Promise<{ code: AuthCode; firstUse: boolean } | undefined> {
    const updated = await this.db
      .updateTable("auth_codes")
      .set({ used_at: now })
      .where("code_hash", "=", codeHash)
      .where("used_at", "is", null)
      .returningAll()
      .executeTakeFirst();
    if (updated) {
      return { code: toAuthCode(updated), firstUse: true };
    }
    const existing = await this.db
      .selectFrom("auth_codes")
      .selectAll()
      .where("code_hash", "=", codeHash)
      .executeTakeFirst();
    return existing ? { code: toAuthCode(existing), firstUse: false } : undefined;
  }

  async createAccessToken(t: AccessToken): Promise<void> {
    await this.db
      .insertInto("access_tokens")
      .values({
        token_hash: t.tokenHash,
        code_hash: t.codeHash,
        client_id: t.clientId,
        sub: t.sub,
        address: t.address,
        scope: t.scope,
        expires_at: t.expiresAt,
        revoked: t.revoked,
      })
      .execute();
  }

  async getAccessToken(tokenHash: string): Promise<AccessToken | undefined> {
    const row = await this.db
      .selectFrom("access_tokens")
      .selectAll()
      .where("token_hash", "=", tokenHash)
      .executeTakeFirst();
    return row ? toAccessToken(row) : undefined;
  }

  async revokeAccessTokensForCode(codeHash: string): Promise<void> {
    await this.db
      .updateTable("access_tokens")
      .set({ revoked: true })
      .where("code_hash", "=", codeHash)
      .execute();
  }

  async deleteExpired(now: Date): Promise<number> {
    const results = await Promise.all([
      this.db.deleteFrom("login_requests").where("expires_at", "<", now).executeTakeFirst(),
      this.db.deleteFrom("auth_codes").where("expires_at", "<", now).executeTakeFirst(),
      this.db.deleteFrom("access_tokens").where("expires_at", "<", now).executeTakeFirst(),
    ]);
    return results.reduce((sum, r) => sum + Number(r.numDeletedRows), 0);
  }
}
