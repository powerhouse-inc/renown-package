import { describe, expect, it } from "vitest";
import {
  addTeam,
  effectiveAllScope,
  archiveOrg,
  initOrganization,
  setOrgListed,
  inviteMember,
  reducer,
  removeTeam,
  setMemberAppScope,
  setMemberHidden,
  setMemberRole,
  setMemberStatus,
  setTeamMembers,
  updateTeam,
  utils,
  type RenownOrgMember,
} from "document-models/renown-organization/v1";

type Doc = ReturnType<typeof utils.createDocument>;
const AT = "2026-10-12T12:00:00.000Z";
const LATER = "2026-10-13T12:00:00.000Z";
const ALICE = "0xabc0000000000000000000000000000000000001";
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const app = (n: number) => `did:key:z6Mk${"x".repeat(40)}${B58[n % 58]}${B58[Math.floor(n / 58) % 58]}`;
const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

function errors(d: Doc): (string | undefined)[] {
  return d.operations.global.map((op) => op.error);
}

/** n invites accepted: m1 OWNER, then MEMBERs. */
function withActive(n: number): Doc {
  let d = utils.createDocument();
  for (let i = 1; i <= n; i++) {
    d = reducer(d, inviteMember({ id: `m${i}`, address: address(i), role: i === 1 ? "OWNER" : "MEMBER", invitedAt: AT }));
    d = reducer(d, setMemberStatus({ id: `m${i}`, status: "ACTIVE", at: AT }));
  }
  return d;
}

function member(d: Doc, id: string): RenownOrgMember {
  return d.state.global.members.find((m) => m.id === id)!;
}

describe("RenownOrganization members module", () => {
  it("invites with a lowercased address and an empty stored scope for every role", () => {
    let d = utils.createDocument();
    d = reducer(d, inviteMember({ id: "m1", address: "0xAbC0000000000000000000000000000000000001", role: "ADMIN", invitedAt: AT }));
    d = reducer(d, inviteMember({ id: "m2", address: address(2), role: "PUBLISHER", invitedAt: AT }));
    expect(d.state.global.members).toEqual([
      {
        id: "m1",
        address: "0xabc0000000000000000000000000000000000001",
        role: "ADMIN",
        status: "INVITED",
        appScope: { all: false, appDids: [] },
        hidden: false,
        joinedAt: null,
        updatedAt: AT,
      },
      {
        id: "m2",
        address: address(2),
        role: "PUBLISHER",
        status: "INVITED",
        appScope: { all: false, appDids: [] },
        hidden: false,
        joinedAt: null,
        updatedAt: AT,
      },
    ]);
  });

  it("refuses a used id or a second open record for an address, allows re-inviting after leaving", () => {
    let d = withActive(2);
    d = reducer(d, inviteMember({ id: "m1", address: address(9), role: "MEMBER", invitedAt: AT }));
    d = reducer(d, inviteMember({ id: "m9", address: address(2), role: "MEMBER", invitedAt: AT }));
    d = reducer(d, setMemberStatus({ id: "m2", status: "LEFT", at: LATER }));
    d = reducer(d, inviteMember({ id: "m10", address: address(2), role: "MEMBER", invitedAt: LATER }));
    expect(errors(d).slice(4)).toEqual([
      `${address(9)} already has an open membership, or the id m1 is used`,
      `${address(2)} already has an open membership, or the id m9 is used`,
      undefined,
      undefined,
    ]);
    expect(member(d, "m10").status).toBe("INVITED");
  });

  it("walks the lifecycle and refuses other transitions", () => {
    let d = withActive(1);
    d = reducer(d, inviteMember({ id: "m2", address: address(2), role: "MEMBER", invitedAt: AT }));
    d = reducer(d, setMemberStatus({ id: "m2", status: "DECLINED", at: LATER }));
    d = reducer(d, setMemberStatus({ id: "m2", status: "ACTIVE", at: LATER }));
    d = reducer(d, setMemberStatus({ id: "m1", status: "INVITED", at: LATER }));
    d = reducer(d, setMemberStatus({ id: "nope", status: "ACTIVE", at: LATER }));
    expect(errors(d).slice(3)).toEqual([
      undefined,
      "DECLINED cannot become ACTIVE",
      "ACTIVE cannot become INVITED",
      "No member with id nope",
    ]);
    expect(member(d, "m1")).toMatchObject({ status: "ACTIVE", joinedAt: AT });
  });

  it("keeps at least one active owner across leave, removal and demotion", () => {
    let d = withActive(2);
    d = reducer(d, setMemberStatus({ id: "m1", status: "LEFT", at: LATER }));
    d = reducer(d, setMemberRole({ id: "m1", role: "ADMIN", at: LATER }));
    d = reducer(d, setMemberRole({ id: "m2", role: "OWNER", at: LATER }));
    d = reducer(d, setMemberRole({ id: "m1", role: "ADMIN", at: LATER }));
    d = reducer(d, setMemberStatus({ id: "m2", status: "REMOVED", at: LATER }));
    expect(errors(d).slice(4)).toEqual([
      "The organization must keep at least one owner",
      "The organization must keep at least one owner",
      undefined,
      undefined,
      "The organization must keep at least one owner",
    ]);
    expect(member(d, "m1")).toMatchObject({ role: "ADMIN", status: "ACTIVE", appScope: { all: false } });
    expect(member(d, "m2")).toMatchObject({ role: "OWNER", status: "ACTIVE", appScope: { all: false } });
  });

  it("caps active members at 500", () => {
    const d = structuredClone(utils.createDocument());
    d.state.global.members = Array.from({ length: 500 }, (_, i) => ({
      id: `m${i}`,
      address: address(i + 1),
      role: i === 0 ? ("OWNER" as const) : ("MEMBER" as const),
      status: "ACTIVE" as const,
      appScope: { all: false, appDids: [] },
      hidden: false,
      joinedAt: AT,
      updatedAt: AT,
    }));
    let next = reducer(d, inviteMember({ id: "late", address: address(999), role: "MEMBER", invitedAt: AT }));
    next = reducer(next, setMemberStatus({ id: "late", status: "ACTIVE", at: AT }));
    expect(errors(next)).toEqual([undefined, "The organization already has 500 active members"]);
  });

  it("changes roles of open members only; role changes never touch the stored scope", () => {
    let d = withActive(2);
    d = reducer(d, setMemberAppScope({ id: "m2", all: false, appDids: [app(1)], at: AT }));
    d = reducer(d, setMemberRole({ id: "m2", role: "PUBLISHER", at: LATER }));
    expect(member(d, "m2")).toMatchObject({ role: "PUBLISHER", appScope: { all: false, appDids: [app(1)] }, updatedAt: LATER });
    d = reducer(d, setMemberRole({ id: "m2", role: "ADMIN", at: LATER }));
    d = reducer(d, setMemberRole({ id: "m2", role: "MEMBER", at: LATER }));
    expect(member(d, "m2").appScope).toEqual({ all: false, appDids: [app(1)] });
    d = reducer(d, setMemberStatus({ id: "m2", status: "LEFT", at: LATER }));
    d = reducer(d, setMemberRole({ id: "m2", role: "PUBLISHER", at: LATER }));
    d = reducer(d, setMemberAppScope({ id: "m2", all: true, appDids: [], at: LATER }));
    expect(errors(d).slice(-2)).toEqual(["Member m2 is LEFT", "Member m2 is LEFT"]);
  });

  it("sets app scopes: deduplicated, validated, stores the given scope; effectiveAllScope derives ALL for owners and admins", () => {
    let d = withActive(2);
    d = reducer(d, setMemberAppScope({ id: "m2", all: false, appDids: [app(1), app(2), app(1)], at: AT }));
    expect(member(d, "m2").appScope).toEqual({ all: false, appDids: [app(1), app(2)] });
    d = reducer(d, setMemberAppScope({ id: "m1", all: false, appDids: [], at: AT }));
    expect(member(d, "m1").appScope).toEqual({ all: false, appDids: [] });
    expect(effectiveAllScope(member(d, "m1"))).toBe(true);
    expect(effectiveAllScope(member(d, "m2"))).toBe(false);
    d = reducer(d, setMemberAppScope({ id: "m2", all: false, appDids: ["did:web:x"], at: AT }));
    d = reducer(d, setMemberAppScope({ id: "m2", all: false, appDids: Array.from({ length: 201 }, (_, i) => app(i)), at: AT }));
    expect(errors(d).slice(-2)).toEqual(["Invalid app DID: did:web:x", "At most 200 app DIDs"]);
    expect(member(d, "m2").appScope.appDids).toEqual([app(1), app(2)]);
    d = reducer(d, setMemberAppScope({ id: "m2", all: true, appDids: [], at: LATER }));
    expect(member(d, "m2").appScope).toEqual({ all: true, appDids: [] });
    expect(effectiveAllScope(member(d, "m2"))).toBe(true);
  });

  it("keeps only the explicit scope when an invited admin is demoted", () => {
    let d = utils.createDocument();
    d = reducer(d, inviteMember({ id: "a1", address: address(5), role: "ADMIN", invitedAt: AT }));
    expect(effectiveAllScope(member(d, "a1"))).toBe(true);
    d = reducer(d, setMemberRole({ id: "a1", role: "PUBLISHER", at: LATER }));
    expect(member(d, "a1").appScope).toEqual({ all: false, appDids: [] });
    expect(effectiveAllScope(member(d, "a1"))).toBe(false);
  });

  it("lets a member hide their membership", () => {
    let d = withActive(2);
    d = reducer(d, setMemberHidden({ id: "m1", hidden: true, at: LATER }));
    expect(member(d, "m1")).toMatchObject({ hidden: true, updatedAt: LATER });
    d = reducer(d, setMemberHidden({ id: "m9", hidden: true, at: LATER }));
    expect(errors(d).at(-1)).toBe("No member with id m9");
    d = reducer(d, setMemberStatus({ id: "m2", status: "LEFT", at: LATER }));
    d = reducer(d, setMemberHidden({ id: "m2", hidden: true, at: LATER }));
    expect(errors(d).at(-1)).toBe("Member m2 is LEFT");
  });

  it("archives: unlisted, invites revoked, active members removed, teams emptied", () => {
    let d = reducer(utils.createDocument(), initOrganization({ handle: "acme", name: "Acme", createdBy: ALICE }));
    d = reducer(d, setOrgListed({ listed: true }));
    d = reducer(d, inviteMember({ id: "m1", address: ALICE, role: "OWNER", invitedAt: AT }));
    d = reducer(d, setMemberStatus({ id: "m1", status: "ACTIVE", at: AT }));
    d = reducer(d, inviteMember({ id: "m2", address: "0xb0b0000000000000000000000000000000000002", role: "MEMBER", invitedAt: AT }));
    d = reducer(d, inviteMember({ id: "m3", address: "0xcafe000000000000000000000000000000000003", role: "MEMBER", invitedAt: AT }));
    d = reducer(d, setMemberStatus({ id: "m3", status: "DECLINED", at: AT }));
    d = reducer(d, addTeam({ id: "t1", slug: "core", name: "Core", appDids: [] }));
    d = reducer(d, setTeamMembers({ id: "t1", memberIds: ["m1"] }));
    d = reducer(d, archiveOrg({ archivedAt: "2026-10-13T00:00:00.000Z" }));
    expect(errors(d).every((e) => e === undefined)).toBe(true);
    expect(d.state.global.archived).toBe(true);
    expect(d.state.global.listed).toBe(false);
    expect(d.state.global.members.map((m) => [m.id, m.status, m.updatedAt])).toEqual([
      ["m1", "REMOVED", "2026-10-13T00:00:00.000Z"],
      ["m2", "REVOKED", "2026-10-13T00:00:00.000Z"],
      ["m3", "DECLINED", AT],
    ]);
    expect(d.state.global.teams[0].memberIds).toEqual([]);
  });
});

describe("RenownOrganization teams", () => {
  it("adds, updates and removes teams", () => {
    let d = withActive(2);
    d = reducer(d, addTeam({ id: "t1", slug: "core", name: "Core", appDids: [app(1), app(1)] }));
    d = reducer(d, addTeam({ id: "t2", slug: "web", name: "Web", appDids: [] }));
    d = reducer(d, updateTeam({ id: "t1", name: "Core team" }));
    d = reducer(d, updateTeam({ id: "t1", slug: "kernel", appDids: [app(2)] }));
    expect(d.state.global.teams).toEqual([
      { id: "t1", slug: "kernel", name: "Core team", appDids: [app(2)], memberIds: [] },
      { id: "t2", slug: "web", name: "Web", appDids: [], memberIds: [] },
    ]);
    d = reducer(d, removeTeam({ id: "t2" }));
    expect(d.state.global.teams.map((t) => t.id)).toEqual(["t1"]);
    expect(errors(d).every((e) => e === undefined)).toBe(true);
  });

  it("refuses duplicate ids and slugs, malformed teams and unknown teams", () => {
    let d = reducer(withActive(1), addTeam({ id: "t1", slug: "core", name: "Core", appDids: [] }));
    d = reducer(d, addTeam({ id: "t2", slug: "web", name: "Web", appDids: [] }));
    d = reducer(d, addTeam({ id: "t1", slug: "other", name: "Other", appDids: [] }));
    d = reducer(d, addTeam({ id: "t3", slug: "Bad Slug", name: "Bad", appDids: [] }));
    d = reducer(d, addTeam({ id: "t3", slug: "bad", name: " ", appDids: [] }));
    d = reducer(d, addTeam({ id: "t3", slug: "core", name: "Again", appDids: [] }));
    d = reducer(d, addTeam({ id: "t3", slug: "apps", name: "Apps", appDids: ["nope"] }));
    d = reducer(d, updateTeam({ id: "t1", slug: "web" }));
    d = reducer(d, updateTeam({ id: "t1", name: "" }));
    d = reducer(d, updateTeam({ id: "t1", appDids: ["nope"] }));
    d = reducer(d, updateTeam({ id: "t9", name: "X" }));
    d = reducer(d, removeTeam({ id: "t9" }));
    expect(errors(d).slice(3)).toEqual([
      undefined,
      "Team id t1 is used",
      "Team slug or name is malformed",
      "Team slug or name is malformed",
      "Another team has the slug core",
      "Invalid app DID: nope",
      "Another team has the slug web",
      "Team slug or name is malformed",
      "Invalid app DID: nope",
      "No team with id t9",
      "No team with id t9",
    ]);
    expect(d.state.global.teams.map((t) => t.slug)).toEqual(["core", "web"]);
  });

  it("caps teams at 50", () => {
    const d = structuredClone(utils.createDocument());
    d.state.global.teams = Array.from({ length: 50 }, (_, i) => ({ id: `t${i}`, slug: `team-${i}`, name: `Team ${i}`, appDids: [], memberIds: [] }));
    const next = reducer(d, addTeam({ id: "t50", slug: "late", name: "Late", appDids: [] }));
    expect(errors(next)).toEqual(["An organization holds at most 50 teams"]);
  });

  it("sets team members (active only, deduplicated) and drops members who stop being active", () => {
    let d = withActive(3);
    d = reducer(d, inviteMember({ id: "m4", address: address(4), role: "MEMBER", invitedAt: AT }));
    d = reducer(d, addTeam({ id: "t1", slug: "core", name: "Core", appDids: [] }));
    d = reducer(d, setTeamMembers({ id: "t1", memberIds: ["m2", "m3", "m2"] }));
    expect(d.state.global.teams[0].memberIds).toEqual(["m2", "m3"]);
    d = reducer(d, setTeamMembers({ id: "t1", memberIds: ["m4"] }));
    d = reducer(d, setTeamMembers({ id: "t1", memberIds: ["m9"] }));
    d = reducer(d, setTeamMembers({ id: "t9", memberIds: [] }));
    expect(errors(d).slice(-3)).toEqual(["Member m4 is not active", "No member with id m9", "No team with id t9"]);
    d = reducer(d, setMemberStatus({ id: "m2", status: "REMOVED", at: LATER }));
    expect(d.state.global.teams[0].memberIds).toEqual(["m3"]);
  });
});
