import { privateKeyToAccount } from "viem/accounts";
import { GraphQLError } from "graphql";
import { describe, expect, it, vi } from "vitest";
import { orgMessage } from "../../../sdk/orgs.js";
import { provenAddress, requireAddress } from "../core/auth.js";
import { loadOrgsConfig, orgDid } from "../core/config.js";
import { badInput, orgError } from "../core/errors.js";

const chain = vi.hoisted(() => ({ verifies: false }));
vi.mock("../../renown-auth/core/smart-wallet.js", () => ({
  verifyMessageOnChain: () => Promise.resolve(chain.verifies),
  verifyTypedDataOnChain: () => Promise.resolve(false),
}));

const ALICE = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const BOB = "0xb0b0000000000000000000000000000000000002";
const NOW = new Date("2026-10-12T12:00:00.000Z");

async function signed(field: string, args: Record<string, unknown>, timestamp = NOW.toISOString()) {
  const message = await orgMessage(field, typeof args.orgId === "string" ? args.orgId : null, args, timestamp);
  return { address: ALICE.address, signature: await ALICE.signMessage({ message }), timestamp };
}

async function code(promise: Promise<unknown>): Promise<unknown> {
  const error = await promise.then(() => undefined, (e: unknown) => e);
  expect(error).toBeInstanceOf(GraphQLError);
  return (error as GraphQLError).extensions.code;
}

describe("caller resolution", () => {
  it("uses the bearer when no auth is sent, lowercased", async () => {
    expect(await provenAddress({ user: { address: "0xB0B0000000000000000000000000000000000002" } }, "leaveOrganization", { orgId: "o" }, NOW)).toBe(BOB);
    expect(await provenAddress({}, "leaveOrganization", { orgId: "o" }, NOW)).toBeNull();
    expect(await provenAddress({ user: { address: "not-an-address" } }, "x", {}, NOW)).toBeNull();
    expect(await code(requireAddress({}, "leaveOrganization", { orgId: "o" }, NOW))).toBe("FORBIDDEN");
  });

  it("accepts a signed message over exactly the sent arguments, even when a bearer is present", async () => {
    const args = { orgId: "org-1", invitee: "bob", role: "MEMBER" };
    const auth = await signed("inviteOrgMember", args);
    expect(await requireAddress({ user: { address: BOB } }, "inviteOrgMember", { ...args, auth }, NOW)).toBe(
      ALICE.address.toLowerCase(),
    );
  });

  it("never falls back to the bearer when auth is present but wrong", async () => {
    const auth = await signed("inviteOrgMember", { orgId: "org-1", invitee: "bob", role: "MEMBER" });
    const ctx = { user: { address: BOB } };
    expect(await code(provenAddress(ctx, "inviteOrgMember", { orgId: "org-1", invitee: "bob", role: "ADMIN", auth }, NOW))).toBe("FORBIDDEN");
    expect(await code(provenAddress(ctx, "inviteOrgMember", { orgId: "org-2", invitee: "bob", role: "MEMBER", auth }, NOW))).toBe("FORBIDDEN");
    expect(await code(provenAddress(ctx, "revokeOrgInvite", { orgId: "org-1", invitee: "bob", role: "MEMBER", auth }, NOW))).toBe("FORBIDDEN");
  });

  it("refuses stale timestamps and malformed addresses", async () => {
    const stale = await signed("leaveOrganization", { orgId: "o" }, "2026-10-12T11:49:00.000Z");
    expect(await code(provenAddress({}, "leaveOrganization", { orgId: "o", auth: stale }, NOW))).toBe("FORBIDDEN");
    const fresh = await signed("leaveOrganization", { orgId: "o" });
    expect(await code(provenAddress({}, "leaveOrganization", { orgId: "o", auth: { ...fresh, address: "alice" } }, NOW))).toBe("FORBIDDEN");
  });

  it("accepts a smart-wallet signature the chain verifies", async () => {
    chain.verifies = true;
    try {
      const auth = { address: BOB, signature: "0x1234", timestamp: NOW.toISOString() };
      expect(await requireAddress({}, "leaveOrganization", { orgId: "o", auth }, NOW)).toBe(BOB);
    } finally {
      chain.verifies = false;
    }
  });
});

describe("config", () => {
  it("defaults safely and reads overrides", () => {
    expect(loadOrgsConfig({})).toEqual({
      didHost: "www.renown.id",
      timelockSeconds: 172800,
      recoverySeconds: 604800,
      platformAdmins: new Set(),
    });
    const config = loadOrgsConfig({
      RENOWN_ORG_DID_HOST: " Renown-Staging.vetra.io ",
      RENOWN_ORG_TIMELOCK_SECONDS: "60",
      RENOWN_ORG_RECOVERY_SECONDS: "-5",
      ADMINS: `${BOB}, junk`,
    });
    expect(config).toMatchObject({ didHost: "renown-staging.vetra.io", timelockSeconds: 60, recoverySeconds: 604800 });
    expect([...config.platformAdmins]).toEqual([BOB]);
    expect([...loadOrgsConfig({ ADMINS: BOB, RENOWN_PLATFORM_ADMINS: ALICE.address }).platformAdmins]).toEqual([
      ALICE.address.toLowerCase(),
    ]);
    expect(loadOrgsConfig({ RENOWN_ORG_DID_HOST: "localhost:3000" }).didHost).toBe("localhost%3A3000");
    expect(loadOrgsConfig({ RENOWN_ORG_DID_HOST: "bad host/" }).didHost).toBe("www.renown.id");
    expect(orgDid("www.renown.id", "abc")).toBe("did:web:www.renown.id:org:abc");
  });
});

describe("errors", () => {
  it("carries the code and, for input errors, the field", () => {
    expect(badInput("handle", "bad").extensions).toEqual({ code: "BAD_USER_INPUT", field: "handle" });
    expect(orgError("LAST_OWNER", "x").extensions).toEqual({ code: "LAST_OWNER" });
  });
});
