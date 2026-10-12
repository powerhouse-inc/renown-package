import { hashTypedData } from "viem";
import { describe, expect, it } from "vitest";
import { canonicalJson, fetchOrgMembership, hasOrgRole, ORG_ROLES, ORG_WEBHOOK_SIGNATURE_HEADER, orgMessage, orgsFromClaims, parseOrgRole, verifyWebhookSignature, RELEASE_DOMAIN, RELEASE_TYPES, releaseTypedData, roleAtLeast } from "../orgs.js";

const TS = "2026-10-12T12:00:00.000Z";

describe("roles", () => {
  it("ranks OWNER > ADMIN > PUBLISHER > MEMBER, case-insensitively", () => {
    expect(ORG_ROLES).toEqual(["OWNER", "ADMIN", "PUBLISHER", "MEMBER"]);
    expect(roleAtLeast("OWNER", "ADMIN")).toBe(true);
    expect(roleAtLeast("publisher", "PUBLISHER")).toBe(true);
    expect(roleAtLeast("MEMBER", "publisher")).toBe(false);
    expect(roleAtLeast("ROOT", "MEMBER")).toBe(false);
    expect(roleAtLeast("MEMBER", "constructor")).toBe(false);
    expect(parseOrgRole(" admin ")).toBe("ADMIN");
    expect(parseOrgRole("toString")).toBeNull();
  });
});

describe("canonicalJson", () => {
  it("sorts keys recursively, drops undefined, keeps null and array order", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: null }], c: "x" }, u: undefined })).toBe(
      '{"a":{"c":"x","d":[3,{"y":null,"z":1}]},"b":1}',
    );
    expect(canonicalJson([undefined, "a"])).toBe('[null,"a"]');
    expect(canonicalJson({})).toBe("{}");
  });
});

describe("orgMessage (renown.id and Vetra pin these vectors)", () => {
  it("hashes the arguments without auth and orgId", async () => {
    expect(await orgMessage("createOrganization", null, { handle: "acme", name: "Acme Inc." }, TS)).toBe(
      `Renown organization createOrganization - 51fc9dfbed0da2cbf914335bc158a6279d52f9f56fc9746e77140b1821312231 at ${TS}`,
    );
    expect(
      await orgMessage("inviteOrgMember", "org-1", { orgId: "org-1", invitee: "bob", role: "PUBLISHER" }, TS),
    ).toBe(`Renown organization inviteOrgMember org-1 ceab60b2f8e9d6c45925d6a2f756b98de0945072e24146e7a46ca907cdc57ec0 at ${TS}`);
    expect(await orgMessage("leaveOrganization", "org-1", { orgId: "org-1" }, TS)).toBe(
      `Renown organization leaveOrganization org-1 44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a at ${TS}`,
    );
    expect(
      await orgMessage(
        "setOrgMemberAppScope",
        "org-1",
        {
          orgId: "org-1",
          address: "0xb0b0000000000000000000000000000000000002",
          appScope: { appDids: ["did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK"], all: false },
        },
        TS,
      ),
    ).toBe(`Renown organization setOrgMemberAppScope org-1 d4e9d9d8ff152bca70736879229c7fd17b5916de16de6964dae4c1fcf437b405 at ${TS}`);
    expect(
      await orgMessage("acceptOrgInviteLink", undefined, { token: "abc", auth: { address: "0x1", signature: "0x", timestamp: TS } }, TS),
    ).toBe(`Renown organization acceptOrgInviteLink - 9c5955952c12f09397bd7fcf56624bea656322913fd00d884661c3b126d17a28 at ${TS}`);
  });
});

describe("release attestations", () => {
  it("signs the spec's EIP-712 domain and type (pinned digest)", () => {
    expect(RELEASE_DOMAIN).toEqual({ name: "Renown Release", version: "1", chainId: 1 });
    expect(RELEASE_TYPES.ReleaseAttestation.map((field) => `${field.type} ${field.name}`)).toEqual([
      "string appDid",
      "string version",
      "string artifactDigest",
      "string orgId",
      "string issuedAt",
    ]);
    const typed = releaseTypedData({
      appDid: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
      version: "1.4.0",
      artifactDigest: `sha256:${"ab".repeat(32)}`,
      orgId: "",
      issuedAt: TS,
    });
    expect(typed.primaryType).toBe("ReleaseAttestation");
    expect(hashTypedData(typed)).toBe("0x43728eb03c4cceb9ea1f9150324df1eef8628987665e83977e7cfe4d0588ebc4");
  });
});

const CLAIMS = {
  sub: "did:pkh:eip155:1:0xAbC0000000000000000000000000000000000001",
  orgs: [
    { id: "o1", did: "did:web:www.renown.id:org:o1", handle: "acme", name: "Acme", role: "PUBLISHER", teams: ["core"], verifiedDomains: ["acme.example"] },
    { id: "o2", did: "did:web:www.renown.id:org:o2", handle: "beta", name: "Beta", role: "owner", teams: [], verifiedDomains: [] },
    { id: "junk" },
    "nope",
    null,
  ],
};

describe("OIDC orgs claim helpers", () => {
  it("reads well-formed entries and checks role thresholds by id or handle", () => {
    expect(orgsFromClaims(CLAIMS).map((o) => [o.id, o.role])).toEqual([["o1", "PUBLISHER"], ["o2", "OWNER"]]);
    for (const bad of [{}, null, undefined, "x", 3, { orgs: "x" }, { orgs: {} }]) expect(orgsFromClaims(bad)).toEqual([]);
    expect(hasOrgRole(CLAIMS, "o1", "PUBLISHER")).toBe(true);
    expect(hasOrgRole(CLAIMS, "ACME", "admin")).toBe(false);
    expect(hasOrgRole(CLAIMS, "ACME", "member")).toBe(true);
    expect(hasOrgRole(CLAIMS, "beta", "ADMIN")).toBe(true);
    expect(hasOrgRole(CLAIMS, "gamma", "MEMBER")).toBe(false);
    expect(hasOrgRole(null, "o1", "MEMBER")).toBe(false);
  });
});

describe("verifyWebhookSignature (receivers pin this vector)", () => {
  const body = '{"id":"e1","type":"ping","orgId":"o1","createdAt":"2026-10-12T12:00:00.000Z","data":{}}';
  const sig = "d75d85f23b7a86faf73cdd020c6fa4436f53a1b646e17bc80d97e2299b4f4d17";
  const header = `t=1791806400,v1=${sig}`;
  const now = 1791806400 * 1000;

  it("accepts the vector and any of several v1 values", async () => {
    expect(ORG_WEBHOOK_SIGNATURE_HEADER).toBe("Renown-Signature");
    expect(await verifyWebhookSignature("whsec-test", header, body, 300, now)).toBe(true);
    expect(await verifyWebhookSignature("whsec-test", `t=1791806400,v1=${"0".repeat(64)},v1=${sig}`, body, 300, now)).toBe(true);
    expect(await verifyWebhookSignature("whsec-test", header, body, 300, now + 300_000)).toBe(true);
  });

  it("rejects a changed body, wrong secret, stale or future timestamp and malformed headers", async () => {
    expect(await verifyWebhookSignature("whsec-test", header, body.replace("ping", "pong"), 300, now)).toBe(false);
    expect(await verifyWebhookSignature("other", header, body, 300, now)).toBe(false);
    expect(await verifyWebhookSignature("whsec-test", header, body, 300, now + 301_000)).toBe(false);
    expect(await verifyWebhookSignature("whsec-test", header, body, 300, now - 301_000)).toBe(false);
    for (const bad of [null, undefined, "", "v1=abc", "t=abc,v1=00", "t=1791806400", `t=1791806400,v1=${sig.slice(2)}`, `t=1791806400,v1=${sig.toUpperCase()}`, `t=-1,v1=${sig}`]) {
      expect(await verifyWebhookSignature("whsec-test", bad, body, 300, now)).toBe(false);
    }
  });
});

describe("fetchOrgMembership", () => {
  const URL = "https://sb.example/graphql/renown-orgs";
  const seen: { url: string; body: unknown }[] = [];
  const reply = (payload: unknown, status = 200) =>
    ((url: string, init?: RequestInit) => {
      seen.push({ url, body: JSON.parse(typeof init?.body === "string" ? init.body : "null") as unknown });
      return Promise.resolve(new Response(JSON.stringify(payload), { status }));
    }) as unknown as typeof fetch;
  const membership = { orgId: "o1", address: "0xabc", role: "PUBLISHER", status: "ACTIVE", appScope: { all: false, appDids: [] }, effectiveScope: { all: false, appDids: ["did:key:z1"] }, teams: ["core"] };

  it("returns the membership or null for a non-member; failures throw (callers fail closed)", async () => {
    expect(await fetchOrgMembership(URL, "o1", "0xABC", { fetch: reply({ data: { orgMembership: membership } }) })).toEqual(membership);
    expect(seen[0]).toMatchObject({ url: URL, body: { variables: { orgId: "o1", address: "0xABC" } } });
    expect(await fetchOrgMembership(URL, "o1", "0xabc", { fetch: reply({ data: { orgMembership: null } }) })).toBeNull();
    expect(await fetchOrgMembership(URL, "o1", "0xabc", { fetch: reply({ data: {} }) })).toBeNull();
    await expect(fetchOrgMembership(URL, "o1", "0xabc", { fetch: reply({ errors: [{ message: "boom" }] }) })).rejects.toThrow("boom");
    await expect(fetchOrgMembership(URL, "o1", "0xabc", { fetch: reply({}, 503) })).rejects.toThrow("503");
  });

  it("times out", async () => {
    const hang = ((_u: string, init?: RequestInit) =>
      new Promise((_r, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as unknown as typeof fetch;
    await expect(fetchOrgMembership(URL, "o1", "0xabc", { fetch: hang, timeoutMs: 20 })).rejects.toThrow("aborted");
  });
});
