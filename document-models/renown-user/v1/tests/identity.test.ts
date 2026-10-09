import { describe, expect, it } from "vitest";
import {
  addLink,
  isValidHandle,
  MAX_LINKS,
  reducer,
  removeLink,
  reorderLinks,
  setAvatar,
  setBio,
  setDisplayName,
  setHandle,
  updateLink,
  utils,
} from "document-models/renown-user/v1";

const REF = `attachment://v1:${"a".repeat(64)}` as const;
const L1 = { id: "link-1", label: "Website", url: "https://frank.example" };
const L2 = { id: "link-2", label: "GitHub", url: "https://github.com/frank" };
const L3 = { id: "link-3", label: "Blog", url: "http://blog.example/feed" };

type Doc = ReturnType<typeof utils.createDocument>;

/** Each global operation's error message (undefined when it applied). */
function errors(doc: Doc): (string | undefined)[] {
  return doc.operations.global.map((op) => op.error);
}

describe("RenownUser identity fields", () => {
  it("edits a full profile and clears it again", () => {
    let d = utils.createDocument();
    d = reducer(d, setDisplayName({ displayName: "Frank" }));
    d = reducer(d, setHandle({ handle: "frank-p" }));
    d = reducer(d, setBio({ bio: "Builds Renown." }));
    d = reducer(d, setAvatar({ avatar: REF }));
    d = reducer(d, addLink(L1));
    d = reducer(d, addLink(L2));
    d = reducer(d, addLink(L3));
    d = reducer(d, updateLink({ id: "link-2", label: "Code" }));
    d = reducer(d, updateLink({ id: "link-2", url: "https://codeberg.org/frank" }));
    d = reducer(d, reorderLinks({ linkIds: ["link-3", "link-1", "link-3"] }));
    expect(errors(d)).toEqual(Array(10).fill(undefined));
    expect(d.state.global).toMatchObject({
      displayName: "Frank",
      handle: "frank-p",
      bio: "Builds Renown.",
      avatar: REF,
      links: [L3, L1, { id: "link-2", label: "Code", url: "https://codeberg.org/frank" }],
    });

    d = reducer(d, removeLink({ id: "link-1" }));
    d = reducer(d, setDisplayName({ displayName: null }));
    d = reducer(d, setHandle({ handle: null }));
    d = reducer(d, setBio({ bio: "" }));
    d = reducer(d, setAvatar({ avatar: null }));
    d = reducer(d, setBio({ bio: null }));
    expect(errors(d).slice(10)).toEqual(Array(6).fill(undefined));
    expect(d.state.global).toMatchObject({
      displayName: null,
      handle: null,
      bio: null,
      avatar: null,
      links: [L3, { id: "link-2", label: "Code", url: "https://codeberg.org/frank" }],
    });
  });

  it("rejects invalid scalar fields and leaves state unchanged", () => {
    let d = utils.createDocument();
    d = reducer(d, setDisplayName({ displayName: "" }));
    d = reducer(d, setDisplayName({ displayName: " Frank" }));
    d = reducer(d, setDisplayName({ displayName: "x".repeat(65) }));
    d = reducer(d, setHandle({ handle: "Frank" }));
    d = reducer(d, setHandle({ handle: "ab" }));
    d = reducer(d, setHandle({ handle: "-frank" }));
    d = reducer(d, setBio({ bio: "b".repeat(281) }));
    d = reducer(d, setAvatar({ avatar: "attachment://v1:not-a-hash" }));
    d = reducer(d, setAvatar({ avatar: `attachment://v2:${"a".repeat(64)}` }));
    const e = errors(d);
    expect(e.slice(0, 3).every((m) => /display name/i.test(m ?? ""))).toBe(true);
    expect(e.slice(3, 6).every((m) => /invalid handle/i.test(m ?? ""))).toBe(true);
    expect(e[6]).toMatch(/280/);
    expect(e.slice(7).every((m) => /avatar/i.test(m ?? ""))).toBe(true);
    expect(d.state.global).toMatchObject({ displayName: null, handle: null, bio: null, avatar: null });
    // Boundaries that are valid.
    d = reducer(d, setDisplayName({ displayName: "x".repeat(64) }));
    d = reducer(d, setBio({ bio: "b".repeat(280) }));
    d = reducer(d, setHandle({ handle: `a${"-".repeat(28)}z` }));
    expect(errors(d).slice(9)).toEqual([undefined, undefined, undefined]);
    expect(isValidHandle("abc")).toBe(true);
    expect(isValidHandle(`a${"b".repeat(29)}`)).toBe(true);
    expect(isValidHandle(`a${"b".repeat(30)}`)).toBe(false);
  });

  it("enforces the link rules", () => {
    let d = utils.createDocument();
    for (let i = 0; i < MAX_LINKS; i++) {
      d = reducer(d, addLink({ id: `l${i}`, label: `L${i}`, url: `https://x.example/${i}` }));
    }
    d = reducer(d, addLink({ id: "l9", label: "Ninth", url: "https://x.example/9" }));
    d = reducer(d, addLink({ id: "l0", label: "Dup", url: "https://x.example/d" }));
    expect(errors(d)[MAX_LINKS]).toMatch(/at most 8/);
    expect(errors(d)[MAX_LINKS + 1]).toMatch(/already used/);

    d = reducer(utils.createDocument(), addLink({ id: "a", label: "", url: "https://ok.example" }));
    d = reducer(d, addLink({ id: "b", label: "x".repeat(41), url: "https://ok.example" }));
    d = reducer(d, addLink({ id: "c", label: "XSS", url: "javascript:alert(1)" }));
    d = reducer(d, addLink({ id: "d", label: "Long", url: `https://x.example/${"p".repeat(2048)}` }));
    d = reducer(d, addLink(L1));
    d = reducer(d, updateLink({ id: "link-1", url: "data:text/html,hi" }));
    d = reducer(d, updateLink({ id: "missing", label: "x" }));
    d = reducer(d, removeLink({ id: "missing" }));
    d = reducer(d, reorderLinks({ linkIds: ["missing"] }));
    const e = errors(d);
    expect(e.slice(0, 2).every((m) => /label/i.test(m ?? ""))).toBe(true);
    expect(e.slice(2, 4).every((m) => /URL/.test(m ?? ""))).toBe(true);
    expect(e[4]).toBeUndefined();
    expect(e[5]).toMatch(/URL/);
    expect(e.slice(6).every((m) => /No link with id missing/.test(m ?? ""))).toBe(true);
    expect(d.state.global.links).toEqual([L1]);
  });

  it("treats a legacy profile without a links list as empty", () => {
    const legacy = () => {
      const doc = utils.createDocument();
      delete (doc.state.global as { links?: unknown }).links;
      return doc;
    };
    expect(reducer(legacy(), addLink(L1)).state.global.links).toEqual([L1]);
    expect(reducer(legacy(), removeLink({ id: "x" })).operations.global[0].error).toMatch(/No link/);
    expect(reducer(legacy(), updateLink({ id: "x" })).operations.global[0].error).toMatch(/No link/);
    expect(reducer(legacy(), reorderLinks({ linkIds: [] })).state.global.links).toEqual([]);
  });
});
