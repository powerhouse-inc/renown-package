import { generateId } from "document-model";
import { describe, expect, it } from "vitest";
import {
  isAppDid,
  isMetricName,
  isUserDid,
  MAX_METRICS_PER_APP,
  reducer,
  setStat,
  setUserDid,
  utils,
} from "document-models/renown-user-stats/v1";

const USER = "did:pkh:eip155:1:0xAbC0000000000000000000000000000000000001";
const OTHER_USER = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";
const APP = "did:key:zDnaerDaTF5BXEavCrfRZEk316dpbLsfPDZ3WJ5hRTPFU2169";
const OTHER_APP = "did:key:z6MkjchhfUsD6mmvni8mCdXHw216Xrm9bQe2mBH1P5RDjVJG";
const T0 = "2026-10-08T10:00:00.000Z";
const T1 = "2026-10-08T11:00:00.000Z";
const T2 = "2026-10-08T12:00:00.000Z";

function withUser() {
  return reducer(utils.createDocument(), setUserDid({ userDid: USER }));
}

describe("RenownUserStats stats module", () => {
  it("keeps the current value per (app, metric) across a reporting flow", () => {
    const [s1, s2, s3, s4, s5, s6] = Array.from({ length: 6 }, () =>
      generateId(),
    );
    let d = withUser();
    d = reducer(d, setUserDid({ userDid: USER })); // same DID again: no-op
    d = reducer(d, setStat({ id: s1, appDid: APP, metric: "messagesSent", value: 3, updatedAt: T0 }));
    d = reducer(d, setStat({ id: s2, appDid: APP, metric: "messagesSent", value: 5, updatedAt: T1 }));
    d = reducer(d, setStat({ id: s3, appDid: OTHER_APP, metric: "messagesSent", value: 1, updatedAt: T1 }));
    d = reducer(d, setStat({ id: s4, appDid: APP, metric: "messagesSent", value: 4, updatedAt: T0 })); // late retry: ignored
    d = reducer(d, setStat({ id: s5, appDid: APP, metric: "messagesSent", value: 5, updatedAt: T1 })); // duplicate: harmless
    d = reducer(d, setStat({ id: s6, appDid: APP, metric: "score", value: 0, updatedAt: T2 })); // falsy but valid

    expect(d.operations.global.map((op) => op.error)).toEqual(
      Array(8).fill(undefined),
    );
    expect(d.state.global.userDid).toBe(USER);
    expect(d.state.global.stats).toEqual([
      { id: s1, appDid: APP, metric: "messagesSent", value: 5, updatedAt: T1 },
      { id: s3, appDid: OTHER_APP, metric: "messagesSent", value: 1, updatedAt: T1 },
      { id: s6, appDid: APP, metric: "score", value: 0, updatedAt: T2 },
    ]);
  });

  it("rejects an invalid user DID and a second, different one", () => {
    let d = reducer(utils.createDocument(), setUserDid({ userDid: "alice" }));
    expect(d.operations.global[0].error).toMatch(/user DID/i);
    expect(d.state.global.userDid).toBeNull();
    d = reducer(d, setUserDid({ userDid: USER }));
    d = reducer(d, setUserDid({ userDid: OTHER_USER }));
    expect(d.operations.global[2].error).toMatch(/belongs to/i);
    expect(d.state.global.userDid).toBe(USER);
  });

  it("rejects stats before the user DID is set", () => {
    const d = reducer(
      utils.createDocument(),
      setStat({ id: generateId(), appDid: APP, metric: "m", value: 1, updatedAt: T0 }),
    );
    expect(d.operations.global[0].error).toMatch(/user DID/i);
    expect(d.state.global.stats).toEqual([]);
  });

  it("rejects a non-did:key app DID and malformed metric names", () => {
    let d = withUser();
    d = reducer(d, setStat({ id: generateId(), appDid: USER, metric: "m", value: 1, updatedAt: T0 }));
    expect(d.operations.global[1].error).toMatch(/app DID/i);
    d = reducer(d, setStat({ id: generateId(), appDid: APP, metric: "has space", value: 1, updatedAt: T0 }));
    expect(d.operations.global[2].error).toMatch(/metric/i);
    expect(d.state.global.stats).toEqual([]);
  });

  it("rejects a new stat that reuses an existing id", () => {
    const id = generateId();
    let d = withUser();
    d = reducer(d, setStat({ id, appDid: APP, metric: "a", value: 1, updatedAt: T0 }));
    d = reducer(d, setStat({ id, appDid: APP, metric: "b", value: 2, updatedAt: T0 }));
    expect(d.operations.global[2].error).toMatch(/already used/i);
    expect(d.state.global.stats).toHaveLength(1);
  });

  it("caps the metrics per app, not per document", () => {
    let d = withUser();
    for (let i = 0; i < MAX_METRICS_PER_APP; i++) {
      d = reducer(d, setStat({ id: generateId(), appDid: APP, metric: `m${i}`, value: i, updatedAt: T0 }));
    }
    d = reducer(d, setStat({ id: generateId(), appDid: APP, metric: "oneTooMany", value: 1, updatedAt: T0 }));
    expect(d.operations.global[MAX_METRICS_PER_APP + 1].error).toMatch(/already reports/i);
    d = reducer(d, setStat({ id: generateId(), appDid: OTHER_APP, metric: "m0", value: 1, updatedAt: T0 }));
    expect(d.operations.global[MAX_METRICS_PER_APP + 2].error).toBeUndefined();
    // Updating an existing metric still works at the cap.
    d = reducer(d, setStat({ id: generateId(), appDid: APP, metric: "m0", value: 99, updatedAt: T1 }));
    expect(
      d.state.global.stats.find((s) => s.appDid === APP && s.metric === "m0")?.value,
    ).toBe(99);
  });
});

describe("utils", () => {
  it("isUserDid", () => {
    expect(isUserDid(USER)).toBe(true);
    expect(isUserDid(OTHER_USER)).toBe(true);
    expect(isUserDid("did:pkh:eip155:0:0xAbC0000000000000000000000000000000000001")).toBe(false);
    expect(isUserDid("did:web:example.com")).toBe(false);
  });
  it("isAppDid", () => {
    expect(isAppDid(APP)).toBe(true);
    expect(isAppDid(USER)).toBe(false);
    expect(isAppDid("did:key:zShort")).toBe(false);
  });
  it("isMetricName", () => {
    expect(isMetricName("messagesSent")).toBe(true);
    expect(isMetricName("vetra.deploys:prod-1")).toBe(true);
    expect(isMetricName("")).toBe(false);
    expect(isMetricName("1st")).toBe(false);
    expect(isMetricName("a".repeat(65))).toBe(false);
  });
});
