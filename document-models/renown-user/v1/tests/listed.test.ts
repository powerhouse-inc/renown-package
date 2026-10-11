import { describe, expect, it } from "vitest";
import { reducer, setHandle, setListed, utils } from "document-models/renown-user/v1";

describe("RenownUser listed (people search opt-in)", () => {
  it("starts unlisted, opts in and out again", () => {
    let d = utils.createDocument();
    expect(d.state.global.listed).toBe(false);

    d = reducer(d, setListed({ listed: true }));
    expect(d.state.global.listed).toBe(true);
    d = reducer(d, setListed({ listed: true }));
    expect(d.state.global.listed).toBe(true);
    d = reducer(d, setListed({ listed: false }));
    expect(d.state.global.listed).toBe(false);
    expect(d.operations.global.map((op) => op.error)).toEqual([undefined, undefined, undefined]);
  });

  it("accepts SET_LISTED on a document created before the field existed", () => {
    let d = utils.createDocument();
    // A profile written before `listed` existed has no key at all.
    const legacy = d.state.global as { listed?: boolean | null };
    delete legacy.listed;
    d = reducer(d, setHandle({ handle: "frank" }));
    expect("listed" in d.state.global).toBe(false);

    d = reducer(d, setListed({ listed: true }));
    expect(d.operations.global.map((op) => op.error)).toEqual([undefined, undefined]);
    expect(d.state.global).toMatchObject({ handle: "frank", listed: true });
  });

  it("the action creator refuses a listed that is not a boolean (input validation, not a reducer error)", () => {
    const d = utils.createDocument();
    expect(() => reducer(d, setListed({ listed: null as unknown as boolean }))).toThrow();
    expect(d.state.global.listed).toBe(false);
  });
});
