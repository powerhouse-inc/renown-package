import { describe, expect, it } from "vitest";
import { DEFAULT_STATS_AUDIENCE, statsAudience, statsProfileApps } from "../core/config.js";
import { addressOf, canonicalAppDid, canonicalUserDid, pkhDidFor } from "../core/dids.js";
import { createKeyedLock } from "../core/keyed-lock.js";

const LOWER = "0xabc0000000000000000000000000000000000001";
const CHECKSUMMED = "0xABC0000000000000000000000000000000000001";
const KEY_DID = "did:key:zDnaerDaTF5BXEavCrfRZEk316dpbLsfPDZ3WJ5hRTPFU2169";

describe("dids", () => {
  it("pkhDidFor uses chain 1 and the EIP-55 address", () => {
    expect(pkhDidFor(LOWER)).toBe(`did:pkh:eip155:1:${CHECKSUMMED}`);
  });

  it("canonicalUserDid folds chains and case into one DID", () => {
    expect(canonicalUserDid(`did:pkh:eip155:137:${LOWER}`)).toBe(`did:pkh:eip155:1:${CHECKSUMMED}`);
    expect(canonicalUserDid(` did:pkh:eip155:1:${LOWER.toUpperCase().replace("0X", "0x")} `)).toBe(
      `did:pkh:eip155:1:${CHECKSUMMED}`,
    );
    expect(canonicalUserDid(KEY_DID)).toBe(KEY_DID);
    expect(canonicalUserDid("did:web:example.com")).toBeNull();
    expect(canonicalUserDid(LOWER)).toBeNull();
  });

  it("canonicalAppDid accepts only did:key", () => {
    expect(canonicalAppDid(` ${KEY_DID} `)).toBe(KEY_DID);
    expect(canonicalAppDid(`did:pkh:eip155:1:${LOWER}`)).toBeNull();
  });

  it("addressOf reads did:pkh DIDs and bare addresses", () => {
    expect(addressOf(`did:pkh:eip155:10:${CHECKSUMMED}`)).toBe(LOWER);
    expect(addressOf(CHECKSUMMED)).toBe(LOWER);
    expect(addressOf(KEY_DID)).toBeNull();
  });
});

describe("statsAudience", () => {
  it("defaults, and trims trailing slashes from an override", () => {
    expect(statsAudience({})).toBe(DEFAULT_STATS_AUDIENCE);
    expect(statsAudience({ RENOWN_STATS_AUDIENCE: "  " })).toBe(DEFAULT_STATS_AUDIENCE);
    expect(statsAudience({ RENOWN_STATS_AUDIENCE: "https://sb.example/graphql/renown-stats/" })).toBe(
      "https://sb.example/graphql/renown-stats",
    );
  });
});

describe("statsProfileApps", () => {
  it("is empty when unset or blank, and splits and trims a comma-separated list", () => {
    expect(statsProfileApps({}).size).toBe(0);
    expect(statsProfileApps({ RENOWN_STATS_PROFILE_APPS: " , " }).size).toBe(0);
    expect([...statsProfileApps({ RENOWN_STATS_PROFILE_APPS: " did:key:zA ,did:key:zB,, " })]).toEqual([
      "did:key:zA",
      "did:key:zB",
    ]);
  });
});

describe("createKeyedLock", () => {
  it("serialises one key, keeps going after a failure, and doesn't block other keys", async () => {
    const lock = createKeyedLock();
    const log: string[] = [];
    const step = (name: string, ms: number) => () =>
      new Promise<string>((resolve) =>
        setTimeout(() => {
          log.push(name);
          resolve(name);
        }, ms),
      );
    const failing = lock("a", () => Promise.reject(new Error("boom")));
    const results = await Promise.all([
      lock("a", step("a1", 20)),
      lock("a", step("a2", 0)),
      lock("b", step("b1", 5)),
      failing.catch((e: Error) => e.message),
    ]);
    expect(results).toEqual(["a1", "a2", "b1", "boom"]);
    expect(log.indexOf("a1")).toBeLessThan(log.indexOf("a2"));
    expect(log.indexOf("b1")).toBeLessThan(log.indexOf("a1"));
  });
});
