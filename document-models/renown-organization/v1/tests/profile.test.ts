import { describe, expect, it } from "vitest";
import {
  archiveOrg,
  initOrganization,
  inviteMember,
  isOrgDomain,
  isOrgName,
  isOrgWebsite,
  isTeamSlug,
  reducer,
  setMemberStatus,
  setMembersPublic,
  setOrgHandle,
  setOrgListed,
  setOrgProfile,
  setTakenDown,
  utils,
} from "document-models/renown-organization/v1";

const ALICE = "0xAbC0000000000000000000000000000000000001";
const AT = "2026-10-12T12:00:00.000Z";
const AVATAR = `attachment://v1:${"a".repeat(64)}`;

function errors(d: ReturnType<typeof utils.createDocument>): (string | undefined)[] {
  return d.operations.global.map((op) => op.error);
}

describe("RenownOrganization profile module", () => {
  it("initializes once with handle, name and a lowercased creator", () => {
    let d = utils.createDocument();
    d = reducer(d, initOrganization({ handle: "acme", name: "Acme Inc.", createdBy: ALICE }));
    expect(d.state.global).toMatchObject({ handle: "acme", name: "Acme Inc.", createdBy: ALICE.toLowerCase() });
    d = reducer(d, initOrganization({ handle: "other", name: "Other", createdBy: ALICE }));
    expect(errors(d)[1]).toBe("The organization is already initialized");
    expect(d.state.global.handle).toBe("acme");
  });

  it("refuses a malformed handle or name on init", () => {
    let d = utils.createDocument();
    d = reducer(d, initOrganization({ handle: "-acme", name: "Acme", createdBy: ALICE }));
    d = reducer(d, initOrganization({ handle: "acme", name: " Acme", createdBy: ALICE }));
    d = reducer(d, initOrganization({ handle: "acme", name: "x".repeat(65), createdBy: ALICE }));
    expect(errors(d)).toEqual([
      "Invalid handle: -acme",
      "The name must be 1-64 characters without surrounding whitespace",
      "The name must be 1-64 characters without surrounding whitespace",
    ]);
    expect(d.state.global.createdBy).toBeNull();
  });

  it("patches the profile: absent and null keep, empty clears, links replace", () => {
    let d = reducer(utils.createDocument(), initOrganization({ handle: "acme", name: "Acme", createdBy: ALICE }));
    d = reducer(
      d,
      setOrgProfile({
        name: "Acme Inc.",
        bio: " Builders ",
        website: "https://acme.example",
        avatar: AVATAR,
        links: [
          { id: "l1", label: "Docs", url: "https://docs.acme.example" },
          { id: "l2", label: "Blog", url: "http://blog.acme.example" },
        ],
      }),
    );
    expect(d.state.global).toMatchObject({
      name: "Acme Inc.",
      bio: "Builders",
      website: "https://acme.example",
      avatar: AVATAR,
      links: [
        { id: "l1", label: "Docs", url: "https://docs.acme.example" },
        { id: "l2", label: "Blog", url: "http://blog.acme.example" },
      ],
    });
    d = reducer(d, setOrgProfile({ name: null, bio: null }));
    expect(d.state.global).toMatchObject({ name: "Acme Inc.", bio: "Builders", website: "https://acme.example" });
    d = reducer(d, setOrgProfile({ bio: "", website: "  ", avatar: "", links: [] }));
    expect(d.state.global).toMatchObject({ bio: null, website: null, avatar: null, links: [] });
    expect(errors(d)).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("refuses each invalid profile field and changes nothing", () => {
    let d = reducer(utils.createDocument(), initOrganization({ handle: "acme", name: "Acme", createdBy: ALICE }));
    const link = (id: string, label: string, url: string) => ({ id, label, url });
    d = reducer(d, setOrgProfile({ name: "" }));
    d = reducer(d, setOrgProfile({ bio: "b".repeat(281) }));
    d = reducer(d, setOrgProfile({ website: "ftp://acme.example" }));
    d = reducer(d, setOrgProfile({ avatar: "https://acme.example/a.png" }));
    d = reducer(d, setOrgProfile({ links: Array.from({ length: 9 }, (_, i) => link(`l${i}`, "x", "https://x.example")) }));
    d = reducer(d, setOrgProfile({ links: [link("l1", "a", "https://a.example"), link("l1", "b", "https://b.example")] }));
    d = reducer(d, setOrgProfile({ links: [link("l1", " ", "https://a.example")] }));
    d = reducer(d, setOrgProfile({ links: [link("l1", "a", "javascript:alert(1)")] }));
    expect(errors(d).slice(1)).toEqual([
      "The name must be 1-64 characters without surrounding whitespace",
      "The bio exceeds 280 characters",
      "Invalid website: ftp://acme.example",
      "Invalid avatar reference: https://acme.example/a.png",
      "An organization holds at most 8 links",
      "Duplicate link id l1",
      "Link l1 needs a 1-40 character label and an http(s) URL",
      "Link l1 needs a 1-40 character label and an http(s) URL",
    ]);
    expect(d.state.global).toMatchObject({ name: "Acme", bio: null, website: null, avatar: null, links: [] });
  });

  it("sets the handle, listed, membersPublic and takenDown", () => {
    let d = reducer(utils.createDocument(), initOrganization({ handle: "acme", name: "Acme", createdBy: ALICE }));
    d = reducer(d, setOrgHandle({ handle: "acme-labs" }));
    d = reducer(d, setOrgHandle({ handle: "Acme" }));
    d = reducer(d, setOrgListed({ listed: true }));
    d = reducer(d, setMembersPublic({ membersPublic: true }));
    d = reducer(d, setTakenDown({ takenDown: true }));
    d = reducer(d, setTakenDown({ takenDown: false }));
    expect(errors(d)[2]).toBe("Invalid handle: Acme");
    expect(d.state.global).toMatchObject({ handle: "acme-labs", listed: true, membersPublic: true, takenDown: false });
  });
});

describe("RenownOrganization utils", () => {
  it("validates names, websites, domains and team slugs", () => {
    expect(isOrgName("Acme")).toBe(true);
    expect(isOrgName("")).toBe(false);
    expect(isOrgWebsite(`https://a.example/${"x".repeat(2048)}`)).toBe(false);
    expect(isOrgWebsite("not a url")).toBe(false);
    expect(isOrgDomain("acme.example")).toBe(true);
    expect(isOrgDomain("xn--80ak6aa92e.com")).toBe(true);
    expect(isOrgDomain("localhost")).toBe(false);
    expect(isOrgDomain("10.0.0.1")).toBe(false);
    expect(isOrgDomain("Acme.example")).toBe(false);
    expect(isTeamSlug("a")).toBe(true);
    expect(isTeamSlug("core-team")).toBe(true);
    expect(isTeamSlug("-core")).toBe(false);
  });
});
