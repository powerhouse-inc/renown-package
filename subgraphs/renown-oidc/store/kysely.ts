import type { Selectable } from "kysely";
import type { AccessToken, AuthCode, LoginRequest, OidcClient } from "../core/types.js";
import {
  AUTH_CODE_RETENTION_MS,
  type AccessTokenRow,
  type AuthCodeRow,
  type LoginRequestRow,
  type OidcClientPatch,
  type OidcClientRow,
  type OidcKysely,
  type OidcStore,
} from "./types.js";

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function parseStringArray(json: string): string[] {
  const value: unknown = JSON.parse(json);
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function toClient(row: Selectable<OidcClientRow>): OidcClient {
  return {
    id: row.client_id,
    name: row.name,
    redirectUris: parseStringArray(row.redirect_uris),
    allowedSubjects: parseStringArray(row.allowed_subjects),
    allowAnySubject: row.allow_any,
    clientSecretHash: row.secret_hash,
    status: row.status,
  };
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

function toAuthCode(row: Selectable<AuthCodeRow>): AuthCode {
  return {
    codeHash: row.code_hash,
    clientId: row.client_id,
    redirectUri: row.redirect_uri,
    sub: row.sub,
    address: row.address,
    chainId: Number(row.chain_id),
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

  async createClient(c: OidcClient, now: Date): Promise<void> {
    await this.db
      .insertInto("oidc_clients")
      .values({
        client_id: c.id,
        name: c.name,
        redirect_uris: JSON.stringify(c.redirectUris),
        allowed_subjects: JSON.stringify(c.allowedSubjects),
        allow_any: c.allowAnySubject,
        secret_hash: c.clientSecretHash,
        status: c.status,
        created_at: now,
        updated_at: now,
      })
      .execute();
  }

  async getClient(clientId: string): Promise<OidcClient | undefined> {
    const row = await this.db
      .selectFrom("oidc_clients")
      .selectAll()
      .where("client_id", "=", clientId)
      .executeTakeFirst();
    return row ? toClient(row) : undefined;
  }

  async updateClient(clientId: string, patch: OidcClientPatch, now: Date): Promise<OidcClient | undefined> {
    const row = await this.db
      .updateTable("oidc_clients")
      .set({
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.redirectUris !== undefined && { redirect_uris: JSON.stringify(patch.redirectUris) }),
        ...(patch.allowedSubjects !== undefined && { allowed_subjects: JSON.stringify(patch.allowedSubjects) }),
        ...(patch.allowAnySubject !== undefined && { allow_any: patch.allowAnySubject }),
        ...(patch.clientSecretHash !== undefined && { secret_hash: patch.clientSecretHash }),
        ...(patch.status !== undefined && { status: patch.status }),
        updated_at: now,
      })
      .where("client_id", "=", clientId)
      .returningAll()
      .executeTakeFirst();
    return row ? toClient(row) : undefined;
  }

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
      this.db
        .deleteFrom("auth_codes")
        .where("expires_at", "<", new Date(now.getTime() - AUTH_CODE_RETENTION_MS))
        .executeTakeFirst(),
      this.db.deleteFrom("access_tokens").where("expires_at", "<", now).executeTakeFirst(),
    ]);
    return results.reduce((sum, r) => sum + Number(r.numDeletedRows), 0);
  }
}
