import { describe, expect, it } from "vitest";
import type { AccessToken, AuthCode, LoginRequest, OidcClient } from "../core/types.js";
import type { OidcStore } from "../store/types.js";

const now = new Date("2026-09-26T12:00:00.000Z");
const at = (ms: number) => new Date(now.getTime() + ms);

const client: OidcClient = {
  id: "client-1",
  name: "Speckle",
  redirectUris: ["https://s.example/cb"],
  allowedSubjects: ["0xabc0000000000000000000000000000000000001"],
  allowAnySubject: false,
  clientSecretHash: "sha256:00",
  status: "ACTIVE",
};

const loginRequest: LoginRequest = {
  id: "req-1",
  clientId: "client-1",
  redirectUri: "https://s.example/cb",
  scope: "openid",
  state: "st",
  nonce: null,
  codeChallenge: "challenge",
  siweNonce: "abcdef0123456789",
  expiresAt: at(600_000),
};

const code: AuthCode = {
  codeHash: "h1",
  clientId: "client-1",
  redirectUri: "https://s.example/cb",
  sub: "did:pkh:eip155:1:0x1",
  address: "0x1",
  // > int4: chain_id is a bigint column.
  chainId: 3_000_000_000,
  nonce: "n",
  codeChallenge: null,
  scope: "openid",
  authTime: now,
  expiresAt: at(60_000),
  usedAt: null,
};

const token = (tokenHash: string, codeHash: string, expiresAt: Date): AccessToken => ({
  tokenHash,
  codeHash,
  clientId: "client-1",
  sub: "did:pkh:eip155:1:0x1",
  address: "0x1",
  scope: "openid",
  expiresAt,
  revoked: false,
});

/** The behaviour every `OidcStore` implementation must share. `makeStore` returns a fresh, empty store. */
export function describeOidcStoreContract(name: string, makeStore: () => Promise<OidcStore>): void {
  describe(`${name} (OidcStore contract)`, () => {
    it("creates, reads and patches clients", async () => {
      const s = await makeStore();
      expect(await s.getClient("client-1")).toBeUndefined();
      await s.createClient(client, now);
      expect(await s.getClient("client-1")).toEqual(client);

      const updated = await s.updateClient(
        "client-1",
        { redirectUris: ["https://a.example/cb", "https://b.example/cb"], allowAnySubject: true, status: "DISABLED" },
        at(1000),
      );
      const expected = {
        ...client,
        redirectUris: ["https://a.example/cb", "https://b.example/cb"],
        allowAnySubject: true,
        status: "DISABLED",
      };
      expect(updated).toEqual(expected);
      expect(await s.getClient("client-1")).toEqual(expected);

      expect(await s.updateClient("client-1", { clientSecretHash: null }, at(2000))).toMatchObject({
        clientSecretHash: null,
        name: "Speckle",
      });
      expect(await s.updateClient("missing", { name: "x" }, now)).toBeUndefined();
    });

    it("refuses a duplicate client id", async () => {
      const s = await makeStore();
      await s.createClient(client, now);
      await expect(s.createClient({ ...client, name: "Other" }, now)).rejects.toThrow();
      expect((await s.getClient("client-1"))?.name).toBe("Speckle");
    });

    it("stores and deletes login requests, round-tripping timestamps", async () => {
      const s = await makeStore();
      await s.createLoginRequest(loginRequest);
      const read = await s.getLoginRequest("req-1");
      expect(read).toEqual(loginRequest);
      expect(read?.expiresAt).toBeInstanceOf(Date);
      await s.deleteLoginRequest("req-1");
      expect(await s.getLoginRequest("req-1")).toBeUndefined();
    });

    it("consumes a code once and reports a replay", async () => {
      const s = await makeStore();
      await s.createAuthCode(code);
      const first = await s.consumeAuthCode("h1", at(1000));
      expect(first?.firstUse).toBe(true);
      expect(first?.code).toEqual({ ...code, usedAt: at(1000) });
      const replay = await s.consumeAuthCode("h1", at(2000));
      expect(replay?.firstUse).toBe(false);
      expect(replay?.code.usedAt).toEqual(at(1000));
      expect(await s.consumeAuthCode("nope", now)).toBeUndefined();
    });

    it("revokes only the tokens minted from a code", async () => {
      const s = await makeStore();
      await s.createAccessToken(token("t1", "h1", at(3600_000)));
      await s.createAccessToken(token("t2", "h2", at(3600_000)));
      await s.revokeAccessTokensForCode("h1");
      expect(await s.getAccessToken("t1")).toEqual({ ...token("t1", "h1", at(3600_000)), revoked: true });
      expect((await s.getAccessToken("t2"))?.revoked).toBe(false);
      expect(await s.getAccessToken("missing")).toBeUndefined();
    });

    it("sweeps expired rows but keeps auth codes for an hour past expiry", async () => {
      const s = await makeStore();
      await s.createLoginRequest({ ...loginRequest, id: "old", expiresAt: at(-1) });
      await s.createLoginRequest(loginRequest);
      await s.createAccessToken(token("old", "h1", at(-1)));
      await s.createAccessToken(token("live", "h1", at(3600_000)));
      await s.createAuthCode({ ...code, codeHash: "recent", expiresAt: at(-60_000) });
      await s.createAuthCode({ ...code, codeHash: "ancient", expiresAt: at(-3600_001) });

      expect(await s.deleteExpired(now)).toBe(3);
      expect(await s.getLoginRequest("old")).toBeUndefined();
      expect(await s.getLoginRequest("req-1")).toBeDefined();
      expect(await s.getAccessToken("old")).toBeUndefined();
      expect(await s.getAccessToken("live")).toBeDefined();
      // A code that expired a minute ago is still recognised as a replay…
      expect((await s.consumeAuthCode("recent", now))?.firstUse).toBe(true);
      // …one past the retention window is gone.
      expect(await s.consumeAuthCode("ancient", now)).toBeUndefined();
    });
  });
}
