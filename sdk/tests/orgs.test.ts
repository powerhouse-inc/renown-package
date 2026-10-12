import { describe, expect, it } from "vitest";
import { canonicalJson, ORG_ROLES, orgMessage, parseOrgRole, roleAtLeast } from "../orgs.js";

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
