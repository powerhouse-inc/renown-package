import { describe, expect, it } from "vitest";
import {
  addLink,
  isAppImageRef,
  isValidLinkUrl,
  MAX_LINKS,
  reducer,
  removeLink,
  reorderLinks,
  setAppDid,
  setProfile,
  updateLink,
  utils,
} from "document-models/renown-app-profile/v1";

const APP = "did:key:zDnaerDaTF5BXEavCrfRZEk316dpbLsfPDZ3WJ5hRTPFU2169";
const LOGO = `attachment://v1:${"a".repeat(64)}`;
const COVER = `attachment://v1:${"b".repeat(64)}`;
const L1 = { id: "link-1", label: "Docs", url: "https://docs.example" };
const L2 = { id: "link-2", label: "GitHub", url: "https://github.com/acme/app" };
const L3 = { id: "link-3", label: "Blog", url: "http://blog.example/feed" };

type Doc = ReturnType<typeof utils.createDocument>;

/** Each global operation's error message (undefined when it applied). */
function errors(doc: Doc): (string | undefined)[] {
  return doc.operations.global.map((op) => op.error);
}

/** A profile whose app DID is set, as every write path leaves it. */
function withApp(): Doc {
  return reducer(utils.createDocument(), setAppDid({ appDid: APP }));
}

describe("RenownAppProfile rich profile", () => {
  it("starts empty", () => {
    expect(utils.createDocument().state.global).toMatchObject({
      description: null,
      category: null,
      logoRef: null,
      coverRef: null,
      links: [],
    });
  });

  it("sets, keeps (null) and clears (empty) description, category and images", () => {
    let d = withApp();
    d = reducer(
      d,
      setProfile({ description: "  Keeps **notes**.  ", category: " Tools ", logoRef: LOGO, coverRef: COVER }),
    );
    d = reducer(d, setProfile({ name: "Vault", description: null, logoRef: null }));
    expect(errors(d)).toEqual([undefined, undefined, undefined]);
    expect(d.state.global).toMatchObject({
      name: "Vault",
      description: "Keeps **notes**.",
      category: "Tools",
      logoRef: LOGO,
      coverRef: COVER,
    });

    d = reducer(d, setProfile({ description: "", category: "", logoRef: "", coverRef: "  " }));
    expect(errors(d)[3]).toBeUndefined();
    expect(d.state.global).toMatchObject({
      name: "Vault",
      description: null,
      category: null,
      logoRef: null,
      coverRef: null,
    });
  });

  it("rejects oversized text and non-attachment image refs without changing anything", () => {
    let d = withApp();
    d = reducer(d, setProfile({ name: "kept?", description: "d".repeat(2001) }));
    d = reducer(d, setProfile({ category: "c".repeat(41) }));
    d = reducer(d, setProfile({ logoRef: "https://cdn.example/logo.png" }));
    d = reducer(d, setProfile({ coverRef: `attachment://v1:${"A".repeat(64)}` }));
    const e = errors(d);
    expect(e[1]).toMatch(/2000/);
    expect(e[2]).toMatch(/40/);
    expect(e[3]).toMatch(/attachment/);
    expect(e[4]).toMatch(/attachment/);
    expect(d.state.global).toMatchObject({
      name: null,
      description: null,
      category: null,
      logoRef: null,
      coverRef: null,
    });
    // Boundaries that are valid.
    d = reducer(d, setProfile({ description: "d".repeat(2000), category: "c".repeat(40) }));
    expect(errors(d)[5]).toBeUndefined();
    expect(isAppImageRef(LOGO)).toBe(true);
    expect(isAppImageRef(`attachment://v2:${"a".repeat(64)}`)).toBe(false);
  });

  it("edits links: add, update label or URL, reorder, remove", () => {
    let d = withApp();
    d = reducer(d, addLink(L1));
    d = reducer(d, addLink(L2));
    d = reducer(d, addLink(L3));
    d = reducer(d, updateLink({ id: "link-2", label: "Code" }));
    d = reducer(d, updateLink({ id: "link-2", url: "https://codeberg.org/acme/app" }));
    d = reducer(d, reorderLinks({ linkIds: ["link-3", "link-1", "link-3"] }));
    d = reducer(d, removeLink({ id: "link-1" }));
    expect(errors(d)).toEqual(Array(8).fill(undefined));
    expect(d.state.global.links).toEqual([
      L3,
      { id: "link-2", label: "Code", url: "https://codeberg.org/acme/app" },
    ]);
  });

  it("enforces the link rules", () => {
    let d = withApp();
    for (let i = 0; i < MAX_LINKS; i++) {
      d = reducer(d, addLink({ id: `l${i}`, label: `L${i}`, url: `https://x.example/${i}` }));
    }
    d = reducer(d, addLink({ id: "l9", label: "Ninth", url: "https://x.example/9" }));
    d = reducer(d, addLink({ id: "l0", label: "Dup", url: "https://x.example/d" }));
    expect(errors(d)[MAX_LINKS + 1]).toMatch(/at most 8/);
    expect(errors(d)[MAX_LINKS + 2]).toMatch(/already used/);

    d = reducer(withApp(), addLink({ id: "a", label: "", url: "https://ok.example" }));
    d = reducer(d, addLink({ id: "b", label: "x".repeat(41), url: "https://ok.example" }));
    d = reducer(d, addLink({ id: "c", label: "XSS", url: "javascript:alert(1)" }));
    d = reducer(d, addLink({ id: "d", label: "Long", url: `https://x.example/${"p".repeat(2048)}` }));
    d = reducer(d, addLink(L1));
    d = reducer(d, updateLink({ id: "link-1", url: "data:text/html,hi" }));
    d = reducer(d, updateLink({ id: "missing", label: "x" }));
    d = reducer(d, removeLink({ id: "missing" }));
    d = reducer(d, reorderLinks({ linkIds: ["missing"] }));
    const e = errors(d);
    expect(e.slice(1, 3).every((m) => /label/i.test(m ?? ""))).toBe(true);
    expect(e.slice(3, 5).every((m) => /URL/.test(m ?? ""))).toBe(true);
    expect(e[5]).toBeUndefined();
    expect(e[6]).toMatch(/URL/);
    expect(e.slice(7).every((m) => /No link with id missing/.test(m ?? ""))).toBe(true);
    expect(d.state.global.links).toEqual([L1]);
    expect(isValidLinkUrl("not a url")).toBe(false);
  });

  it("treats a legacy profile without the new keys as empty", () => {
    const legacy = () => {
      const doc = withApp();
      const state = doc.state.global as Record<string, unknown>;
      for (const key of ["description", "category", "logoRef", "coverRef", "links"]) delete state[key];
      return doc;
    };
    expect(reducer(legacy(), addLink(L1)).state.global.links).toEqual([L1]);
    expect(reducer(legacy(), removeLink({ id: "x" })).operations.global[1].error).toMatch(/No link/);
    expect(reducer(legacy(), updateLink({ id: "x" })).operations.global[1].error).toMatch(/No link/);
    expect(reducer(legacy(), reorderLinks({ linkIds: [] })).state.global.links).toEqual([]);
    expect(reducer(legacy(), setProfile({ category: "Tools" })).state.global).toMatchObject({ category: "Tools" });
  });
});
