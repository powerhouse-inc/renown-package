import type { AccessToken, AuthCode, LoginRequest } from "../core/types.js";
import type { OidcStore } from "./types.js";

/** In-memory `OidcStore`, backed by Maps. For tests and local dev only. */
export class MemoryOidcStore implements OidcStore {
  private readonly loginRequests = new Map<string, LoginRequest>();
  private readonly authCodes = new Map<string, AuthCode>();
  private readonly accessTokens = new Map<string, AccessToken>();

  async createLoginRequest(r: LoginRequest): Promise<void> {
    this.loginRequests.set(r.id, r);
  }

  async getLoginRequest(id: string): Promise<LoginRequest | undefined> {
    return this.loginRequests.get(id);
  }

  async deleteLoginRequest(id: string): Promise<void> {
    this.loginRequests.delete(id);
  }

  async createAuthCode(c: AuthCode): Promise<void> {
    this.authCodes.set(c.codeHash, c);
  }

  async consumeAuthCode(
    codeHash: string,
    now: Date,
  ): Promise<{ code: AuthCode; firstUse: boolean } | undefined> {
    const existing = this.authCodes.get(codeHash);
    if (!existing) return undefined;
    if (existing.usedAt !== null) {
      return { code: existing, firstUse: false };
    }
    const used: AuthCode = { ...existing, usedAt: now };
    this.authCodes.set(codeHash, used);
    return { code: used, firstUse: true };
  }

  async createAccessToken(t: AccessToken): Promise<void> {
    this.accessTokens.set(t.tokenHash, t);
  }

  async getAccessToken(tokenHash: string): Promise<AccessToken | undefined> {
    return this.accessTokens.get(tokenHash);
  }

  async revokeAccessTokensForCode(codeHash: string): Promise<void> {
    for (const [hash, token] of this.accessTokens) {
      if (token.codeHash === codeHash) {
        this.accessTokens.set(hash, { ...token, revoked: true });
      }
    }
  }

  async deleteExpired(now: Date): Promise<number> {
    let deleted = 0;
    for (const [id, r] of this.loginRequests) {
      if (r.expiresAt < now) {
        this.loginRequests.delete(id);
        deleted++;
      }
    }
    for (const [hash, c] of this.authCodes) {
      if (c.expiresAt < now) {
        this.authCodes.delete(hash);
        deleted++;
      }
    }
    for (const [hash, t] of this.accessTokens) {
      if (t.expiresAt < now) {
        this.accessTokens.delete(hash);
        deleted++;
      }
    }
    return deleted;
  }
}
