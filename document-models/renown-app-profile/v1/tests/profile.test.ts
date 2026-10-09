import { describe, expect, it } from "vitest";
import {
  isAppDid,
  isLogo,
  isPublisherDid,
  isWebsite,
  reducer,
  setAppDid,
  setProfile,
  setPublisherDid,
  utils,
} from "document-models/renown-app-profile/v1";

const APP = "did:key:zDnaerDaTF5BXEavCrfRZEk316dpbLsfPDZ3WJ5hRTPFU2169";
const OTHER_APP = "did:key:z6MkjchhfUsD6mmvni8mCdXHw216Xrm9bQe2mBH1P5RDjVJG";
const PUBLISHER = "did:pkh:eip155:1:0xAbC0000000000000000000000000000000000001";
const LOGO = "data:image/png;base64,iVBORw0KGgo=";

describe("RenownAppProfile profile module", () => {
  it("builds a profile end to end, patching and clearing fields", () => {
    let d = utils.createDocument();
    d = reducer(d, setAppDid({ appDid: APP }));
    d = reducer(d, setAppDid({ appDid: APP })); // same DID again: no-op
    d = reducer(d, setPublisherDid({ publisherDid: PUBLISHER }));
    d = reducer(
      d,
      setProfile({
        name: " Speckle ",
        tagline: "3D data",
        logo: LOGO,
        website: "https://speckle.systems",
      }),
    );
    d = reducer(d, setProfile({ tagline: "", logo: null })); // clear tagline, keep logo
    d = reducer(d, setProfile({ name: "Speckle Pro" }));
    d = reducer(
      d,
      setProfile({
        logo: "https://cdn.example/logo.png",
        website: "http://localhost:3000",
      }),
    );

    expect(d.operations.global.map((op) => op.error)).toEqual(
      Array(7).fill(undefined),
    );
    expect(d.state.global).toEqual({
      appDid: APP,
      publisherDid: PUBLISHER,
      name: "Speckle Pro",
      tagline: null,
      logo: "https://cdn.example/logo.png",
      website: "http://localhost:3000",
      description: null,
      category: null,
      logoRef: null,
      coverRef: null,
      links: [],
      metrics: [],
    });
  });

  it("rejects a non-did:key app DID and a second, different one", () => {
    let d = reducer(utils.createDocument(), setAppDid({ appDid: PUBLISHER }));
    expect(d.operations.global[0].error).toMatch(/app DID/i);
    d = reducer(d, setAppDid({ appDid: APP }));
    d = reducer(d, setAppDid({ appDid: OTHER_APP }));
    expect(d.operations.global[2].error).toMatch(/belongs to/i);
    expect(d.state.global.appDid).toBe(APP);
  });

  it("rejects a publisher that is not a wallet DID", () => {
    const d = reducer(
      utils.createDocument(),
      setPublisherDid({ publisherDid: APP }),
    );
    expect(d.operations.global[0].error).toMatch(/publisher/i);
    expect(d.state.global.publisherDid).toBeNull();
  });

  it("rejects profile edits before the app DID is set", () => {
    const d = reducer(utils.createDocument(), setProfile({ name: "x" }));
    expect(d.operations.global[0].error).toMatch(/app DID/i);
    expect(d.state.global.name).toBeNull();
  });

  it("rejects unsafe websites and logos without changing anything", () => {
    let d = reducer(utils.createDocument(), setAppDid({ appDid: APP }));
    d = reducer(
      d,
      setProfile({ name: "kept?", website: "javascript:alert(1)" }),
    );
    expect(d.operations.global[1].error).toMatch(/website/i);
    d = reducer(d, setProfile({ logo: "http://insecure.example/logo.png" }));
    expect(d.operations.global[2].error).toMatch(/logo/i);
    d = reducer(d, setProfile({ logo: "data:text/html;base64,PGgxPg==" }));
    expect(d.operations.global[3].error).toMatch(/logo/i);
    expect(d.state.global).toMatchObject({
      name: null,
      website: null,
      logo: null,
    });
  });
});

describe("utils", () => {
  it("isAppDid / isPublisherDid", () => {
    expect(isAppDid(APP)).toBe(true);
    expect(isAppDid(PUBLISHER)).toBe(false);
    expect(isPublisherDid(PUBLISHER)).toBe(true);
    expect(isPublisherDid(APP)).toBe(false);
  });
  it("isWebsite", () => {
    expect(isWebsite("https://a.b/c")).toBe(true);
    expect(isWebsite("http://a.b")).toBe(true);
    expect(isWebsite("ftp://a.b")).toBe(false);
    expect(isWebsite("not a url")).toBe(false);
  });
  it("isLogo", () => {
    expect(isLogo(LOGO)).toBe(true);
    // SVG can carry script; only raster data URLs are accepted.
    expect(isLogo("data:image/svg+xml;base64,PHN2Zz4=")).toBe(false);
    expect(isLogo("https://cdn.example/l.png")).toBe(true);
    expect(isLogo("http://cdn.example/l.png")).toBe(false);
    expect(isLogo("nope")).toBe(false);
  });
});
