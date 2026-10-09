import { describe, expect, it } from "vitest";
import {
  addAllowedSubject,
  addRedirectUri,
  reducer,
  removeAllowedSubject,
  removeRedirectUri,
  setAllowAnySubject,
  setClientInfo,
  setClientSecretHash,
  setStatus,
  utils,
} from "document-models/renown-oidc-client/v1";
import {
  isValidRedirectUri,
  normalizeSubject,
} from "document-models/renown-oidc-client/v1/src/utils.js";

const ADDR = "0xAbC0000000000000000000000000000000000001";

describe("RenownOidcClient client module", () => {
  it("sets the name and rejects an empty one", () => {
    let d = reducer(utils.createDocument(), setClientInfo({ name: "Speckle cool-frog" }));
    expect(d.state.global.name).toBe("Speckle cool-frog");
    d = reducer(d, setClientInfo({ name: "   " }));
    expect(d.operations.global[1].error).toMatch(/name/i);
    expect(d.state.global.name).toBe("Speckle cool-frog");
  });

  it("adds https redirect URIs once and removes them", () => {
    let d = utils.createDocument();
    d = reducer(d, addRedirectUri({ uri: "https://x-speckle.vetra.io/auth/oidc/callback" }));
    d = reducer(d, addRedirectUri({ uri: "https://x-speckle.vetra.io/auth/oidc/callback" }));
    expect(d.state.global.redirectUris).toEqual(["https://x-speckle.vetra.io/auth/oidc/callback"]);
    d = reducer(d, removeRedirectUri({ uri: "https://x-speckle.vetra.io/auth/oidc/callback" }));
    expect(d.state.global.redirectUris).toEqual([]);
  });

  it("rejects non-https redirect URIs except localhost", () => {
    let d = reducer(utils.createDocument(), addRedirectUri({ uri: "http://evil.example/cb" }));
    expect(d.operations.global[0].error).toMatch(/redirect/i);
    d = reducer(d, addRedirectUri({ uri: "http://localhost:3000/cb" }));
    expect(d.state.global.redirectUris).toEqual(["http://localhost:3000/cb"]);
    d = reducer(d, addRedirectUri({ uri: "https://ok.example/cb#frag" }));
    expect(d.operations.global[2].error).toMatch(/redirect/i);
  });

  it("normalises subjects from DIDs and addresses, dedupes, removes", () => {
    let d = utils.createDocument();
    d = reducer(d, addAllowedSubject({ subject: `did:pkh:eip155:1:${ADDR}` }));
    d = reducer(d, addAllowedSubject({ subject: ADDR.toLowerCase() }));
    expect(d.state.global.allowedSubjects).toEqual([ADDR.toLowerCase()]);
    d = reducer(d, removeAllowedSubject({ subject: ADDR }));
    expect(d.state.global.allowedSubjects).toEqual([]);
  });

  it("rejects malformed subjects", () => {
    const d = reducer(utils.createDocument(), addAllowedSubject({ subject: "alice" }));
    expect(d.operations.global[0].error).toMatch(/subject/i);
  });

  it("toggles allowAnySubject and status", () => {
    let d = reducer(utils.createDocument(), setAllowAnySubject({ allow: true }));
    expect(d.state.global.allowAnySubject).toBe(true);
    d = reducer(d, setStatus({ status: "DISABLED" }));
    expect(d.state.global.status).toBe("DISABLED");
  });

  it("accepts only sha256:<64 hex> secret hashes, or null", () => {
    let d = reducer(utils.createDocument(), setClientSecretHash({ hash: "sha256:" + "a".repeat(64) }));
    expect(d.state.global.clientSecretHash).toBe("sha256:" + "a".repeat(64));
    d = reducer(d, setClientSecretHash({ hash: "plaintext-secret" }));
    expect(d.operations.global[1].error).toMatch(/hash/i);
    d = reducer(d, setClientSecretHash({ hash: null }));
    expect(d.state.global.clientSecretHash).toBeNull();
  });
});

describe("utils", () => {
  it("normalizeSubject", () => {
    expect(normalizeSubject(`did:pkh:eip155:137:${ADDR}`)).toBe(ADDR.toLowerCase());
    expect(() => normalizeSubject("did:key:z6Mk")).toThrow();
  });
  it("isValidRedirectUri", () => {
    expect(isValidRedirectUri("https://a.b/c")).toBe(true);
    expect(isValidRedirectUri("http://127.0.0.1:8080/cb")).toBe(true);
    expect(isValidRedirectUri("http://a.b/c")).toBe(false);
    expect(isValidRedirectUri("not a url")).toBe(false);
    expect(isValidRedirectUri("https://a.b/c#x")).toBe(false);
  });
});
