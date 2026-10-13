import { describe, expect, it } from "vitest";
import { loadOrgsConfig } from "../core/config.js";
import type { OrgContext } from "../core/auth.js";
import { clientKey } from "../runtime.js";

const TOKEN = "s3cret-read-token";
const ctx = (headers: Record<string, string>, address?: string) =>
  ({ headers, user: address ? { address } : undefined }) as unknown as OrgContext;
const trusted = (ip: string | undefined, token = TOKEN) => ctx({ "x-renown-read-token": token, ...(ip ? { "x-renown-client-ip": ip } : {}), "x-forwarded-for": "10.0.0.9" });

describe("trusted read token", () => {
  it("loads from env, empty means unset", () => {
    expect(loadOrgsConfig({ RENOWN_TRUSTED_READ_TOKEN: ` ${TOKEN} ` }).trustedReadToken).toBe(TOKEN);
    expect(loadOrgsConfig({ RENOWN_TRUSTED_READ_TOKEN: " " }).trustedReadToken).toBeNull();
    expect(loadOrgsConfig({}).trustedReadToken).toBeNull();
  });

  it("keys on the forwarded client IP with a valid token", () => {
    expect(clientKey(trusted("1.1.1.1"), TOKEN)).toBe("ip:1.1.1.1");
    expect(clientKey(trusted("2.2.2.2"), TOKEN)).toBe("ip:2.2.2.2");
    expect(clientKey(trusted("2001:DB8::1"), TOKEN)).toBe("ip:2001:db8::1");
  });

  it("uses the default key for a wrong token", () => {
    expect(clientKey(trusted("1.1.1.1", "nope"), TOKEN)).toBe("ip:10.0.0.9");
    expect(clientKey(trusted("1.1.1.1", TOKEN + "x"), TOKEN)).toBe("ip:10.0.0.9");
  });

  it("uses the default key for a missing or invalid client IP", () => {
    expect(clientKey(trusted(undefined), TOKEN)).toBe("ip:10.0.0.9");
    expect(clientKey(trusted("not-an-ip"), TOKEN)).toBe("ip:10.0.0.9");
    expect(clientKey(trusted("1.1.1.1, 2.2.2.2"), TOKEN)).toBe("ip:10.0.0.9");
  });

  it("ignores the header when the token is unset or empty", () => {
    expect(clientKey(trusted("1.1.1.1", ""), null)).toBe("ip:10.0.0.9");
    expect(clientKey(trusted("1.1.1.1"), null)).toBe("ip:10.0.0.9");
  });

  it("only changes the key, never bypasses", () => {
    expect(clientKey(trusted("1.1.1.1"), TOKEN)).toBe(clientKey(trusted("1.1.1.1"), TOKEN));
  });
});
