import { describe, expect, it } from "vitest";
import { addOrgApp, reducer, removeOrgApp, setAppFrozen, utils } from "document-models/renown-organization/v1";

const APP = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";
const OTHER = "did:key:zDnaerDaTF5BXEavCrfRZEk316dpbLsfPDZ3WJ5hRTPFU2169";
const AT = "2026-10-12T12:00:00.000Z";

describe("RenownOrganization apps module", () => {
  it("adds, freezes, unfreezes and removes apps", () => {
    let d = utils.createDocument();
    d = reducer(d, addOrgApp({ appDid: APP, addedAt: AT }));
    d = reducer(d, addOrgApp({ appDid: OTHER, addedAt: AT }));
    d = reducer(d, setAppFrozen({ appDid: APP, frozen: true }));
    expect(d.state.global.apps).toEqual([
      { appDid: APP, addedAt: AT, frozen: true },
      { appDid: OTHER, addedAt: AT, frozen: false },
    ]);
    d = reducer(d, setAppFrozen({ appDid: APP, frozen: false }));
    d = reducer(d, removeOrgApp({ appDid: APP }));
    expect(d.state.global.apps).toEqual([{ appDid: OTHER, addedAt: AT, frozen: false }]);
    expect(d.operations.global.every((op) => op.error === undefined)).toBe(true);
  });

  it("refuses invalid, duplicate and unknown apps", () => {
    let d = reducer(utils.createDocument(), addOrgApp({ appDid: APP, addedAt: AT }));
    d = reducer(d, addOrgApp({ appDid: "did:pkh:eip155:1:0x1", addedAt: AT }));
    d = reducer(d, addOrgApp({ appDid: APP, addedAt: AT }));
    d = reducer(d, removeOrgApp({ appDid: OTHER }));
    d = reducer(d, setAppFrozen({ appDid: OTHER, frozen: true }));
    expect(d.operations.global.map((op) => op.error)).toEqual([
      undefined,
      "Invalid app DID: did:pkh:eip155:1:0x1",
      `${APP} already belongs to the organization`,
      `${OTHER} is not an app of the organization`,
      `${OTHER} is not an app of the organization`,
    ]);
    expect(d.state.global.apps).toHaveLength(1);
  });
});
