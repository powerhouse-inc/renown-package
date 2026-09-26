import { describe, expect, it } from "vitest";
import { MemoryOidcStore } from "../store/memory.js";

const now = new Date("2026-09-26T12:00:00Z"),
  later = new Date(now.getTime() + 120_000);
const code = {
  codeHash: "h1",
  clientId: "c",
  redirectUri: "https://s/cb",
  sub: "did:pkh:eip155:1:0x1",
  address: "0x1",
  chainId: 1,
  nonce: null,
  codeChallenge: null,
  scope: "openid",
  authTime: now,
  expiresAt: new Date(now.getTime() + 60_000),
  usedAt: null,
};

describe("MemoryOidcStore", () => {
  it("consumes a code once and reports replay", async () => {
    const s = new MemoryOidcStore();
    await s.createAuthCode(code);
    expect((await s.consumeAuthCode("h1", now))?.firstUse).toBe(true);
    expect((await s.consumeAuthCode("h1", now))?.firstUse).toBe(false);
    expect(await s.consumeAuthCode("nope", now)).toBeUndefined();
  });

  it("revokes tokens per code and deletes expired rows", async () => {
    const s = new MemoryOidcStore();
    await s.createAccessToken({
      tokenHash: "t1",
      codeHash: "h1",
      clientId: "c",
      sub: "x",
      address: "0x1",
      scope: "openid",
      expiresAt: later,
      revoked: false,
    });
    await s.createAccessToken({
      tokenHash: "t2",
      codeHash: "h2",
      clientId: "c",
      sub: "x",
      address: "0x1",
      scope: "openid",
      expiresAt: new Date(now.getTime() - 1),
      revoked: false,
    });
    await s.revokeAccessTokensForCode("h1");
    expect((await s.getAccessToken("t1"))?.revoked).toBe(true);
    expect(await s.deleteExpired(now)).toBe(1);
    expect(await s.getAccessToken("t2")).toBeUndefined();
  });

  it("stores and deletes login requests", async () => {
    const s = new MemoryOidcStore();
    await s.createLoginRequest({
      id: "r",
      clientId: "c",
      redirectUri: "https://s/cb",
      scope: "openid",
      state: null,
      nonce: null,
      codeChallenge: null,
      siweNonce: "n",
      expiresAt: later,
    });
    expect((await s.getLoginRequest("r"))?.clientId).toBe("c");
    await s.deleteLoginRequest("r");
    expect(await s.getLoginRequest("r")).toBeUndefined();
  });
});
