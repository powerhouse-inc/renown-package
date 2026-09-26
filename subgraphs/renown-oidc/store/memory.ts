import type { AccessToken, AuthCode, LoginRequest, OidcClient } from "../core/types.js";
import type { OidcClientPatch, OidcStore } from "./types.js";

function cloneClient(c: OidcClient): OidcClient {
  return { ...c, redirectUris: [...c.redirectUris], allowedSubjects: [...c.allowedSubjects] };
}

/** In-memory `OidcStore`, backed by Maps. For tests and local dev only. */
export class MemoryOidcStore implements OidcStore {
  private readonly clients = new Map<string, OidcClient>();
  private readonly loginRequests = new Map<string, LoginRequest>();

  async createClient(c: OidcClient, _now: Date): Promise<void> {
    if (this.clients.has(c.id)) throw new Error(`Client ${c.id} already exists`);
    this.clients.set(c.id, cloneClient(c));
  }

  async getClient(clientId: string): Promise<OidcClient | undefined> {
    const client = this.clients.get(clientId);
    return client ? cloneClient(client) : undefined;
  }

  async updateClient(clientId: string, patch: OidcClientPatch, _now: Date): Promise<OidcClient | undefined> {
    const existing = this.clients.get(clientId);
    if (!existing) return undefined;
    const defined = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
    const updated = cloneClient({ ...existing, ...defined });
    this.clients.set(clientId, updated);
    return cloneClient(updated);
  }
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
