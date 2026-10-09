import { describe, expect, it } from "vitest";
import {
  addMetric,
  isMetricKey,
  MAX_METRICS,
  metricProblem,
  reducer,
  removeMetric,
  reorderMetrics,
  setAppDid,
  updateMetric,
  utils,
} from "document-models/renown-app-profile/v1";

const APP = "did:key:zDnaerDaTF5BXEavCrfRZEk316dpbLsfPDZ3WJ5hRTPFU2169";
const NOTES = {
  id: "m-notes",
  key: "notes",
  label: "Notes",
  unit: "notes",
  description: "Notes written",
  aggregation: "SUM" as const,
  public: true,
};
const STREAK = {
  id: "m-streak",
  key: "streak.days",
  label: "Longest streak",
  unit: null,
  description: null,
  aggregation: "MAX" as const,
  public: false,
};
const SCORE = { id: "m-score", key: "score", label: "Score", aggregation: "AVG" as const, public: true };

type Doc = ReturnType<typeof utils.createDocument>;

/** Each global operation's error message (undefined when it applied). */
function errors(doc: Doc): (string | undefined)[] {
  return doc.operations.global.map((op) => op.error);
}

function withApp(): Doc {
  return reducer(utils.createDocument(), setAppDid({ appDid: APP }));
}

describe("RenownAppProfile metrics", () => {
  it("starts with no metrics", () => {
    expect(utils.createDocument().state.global.metrics).toEqual([]);
  });

  it("declares, edits, reorders and removes metrics", () => {
    let d = withApp();
    d = reducer(d, addMetric({ ...NOTES, label: "  Notes ", unit: " notes " }));
    d = reducer(d, addMetric(STREAK));
    d = reducer(d, addMetric({ ...SCORE, unit: "", description: "   " }));
    d = reducer(d, updateMetric({ id: "m-streak", label: "Best streak", public: true }));
    d = reducer(d, updateMetric({ id: "m-score", key: "score.avg", aggregation: "COUNT_USERS", unit: "pts" }));
    d = reducer(d, updateMetric({ id: "m-notes" }));
    d = reducer(d, reorderMetrics({ metricIds: ["m-score", "m-streak", "m-score"] }));
    d = reducer(d, removeMetric({ id: "m-streak" }));
    expect(errors(d)).toEqual(Array(9).fill(undefined));
    expect(d.state.global.metrics).toEqual([
      {
        id: "m-score",
        key: "score.avg",
        label: "Score",
        unit: "pts",
        description: null,
        aggregation: "COUNT_USERS",
        public: true,
      },
      { ...NOTES },
    ]);
  });

  it("clears a unit or description with an empty string and keeps a falsy public flag", () => {
    let d = withApp();
    d = reducer(d, addMetric(NOTES));
    d = reducer(d, updateMetric({ id: "m-notes", unit: "", description: " ", public: false }));
    expect(errors(d)[2]).toBeUndefined();
    expect(d.state.global.metrics[0]).toMatchObject({ unit: null, description: null, public: false });
  });

  it("enforces the limits, unique ids and unique keys", () => {
    let d = withApp();
    for (let i = 0; i < MAX_METRICS; i++) {
      d = reducer(d, addMetric({ ...SCORE, id: `m${i}`, key: `k${i}` }));
    }
    d = reducer(d, addMetric({ ...SCORE, id: "m-extra", key: "extra" }));
    expect(errors(d)[MAX_METRICS + 1]).toMatch(/at most 16/);

    d = reducer(withApp(), addMetric(NOTES));
    d = reducer(d, addMetric({ ...NOTES, key: "other" }));
    d = reducer(d, addMetric({ ...NOTES, id: "m-2" }));
    d = reducer(d, addMetric({ ...STREAK }));
    d = reducer(d, updateMetric({ id: "m-streak", key: "notes" }));
    const e = errors(d);
    expect(e[2]).toMatch(/id m-notes is already used/);
    expect(e[3]).toMatch(/key notes is already declared/);
    expect(e[4]).toBeUndefined();
    expect(e[5]).toMatch(/key notes is already declared/);
    expect(d.state.global.metrics.map((m) => m.key)).toEqual(["notes", "streak.days"]);
  });

  it("rejects invalid fields on add and update without changing anything", () => {
    let d = withApp();
    d = reducer(d, addMetric({ ...NOTES, key: "1notes" }));
    d = reducer(d, addMetric({ ...NOTES, key: "has space" }));
    d = reducer(d, addMetric({ ...NOTES, label: "   " }));
    d = reducer(d, addMetric({ ...NOTES, label: "l".repeat(41) }));
    d = reducer(d, addMetric({ ...NOTES, unit: "u".repeat(17) }));
    d = reducer(d, addMetric({ ...NOTES, description: "d".repeat(201) }));
    d = reducer(d, addMetric({ ...NOTES, label: "l".repeat(40), unit: "u".repeat(16), description: "d".repeat(200) }));
    d = reducer(d, updateMetric({ id: "m-notes", key: "k".repeat(65) }));
    d = reducer(d, updateMetric({ id: "m-notes", label: "" }));
    const e = errors(d);
    expect(e[1]).toMatch(/key/);
    expect(e[2]).toMatch(/key/);
    expect(e[3]).toMatch(/label/);
    expect(e[4]).toMatch(/label/);
    expect(e[5]).toMatch(/unit/);
    expect(e[6]).toMatch(/description/);
    expect(e[7]).toBeUndefined();
    expect(e[8]).toMatch(/key/);
    expect(e[9]).toMatch(/label/);
    expect(d.state.global.metrics).toHaveLength(1);
    expect(d.state.global.metrics[0]?.key).toBe("notes");
  });

  it("reports unknown metric ids", () => {
    let d = withApp();
    d = reducer(d, updateMetric({ id: "missing", label: "x" }));
    d = reducer(d, removeMetric({ id: "missing" }));
    d = reducer(d, reorderMetrics({ metricIds: ["missing"] }));
    expect(errors(d).slice(1).every((m) => /No metric with id missing/.test(m ?? ""))).toBe(true);
  });

  it("treats a legacy profile without a metrics key as empty", () => {
    const legacy = () => {
      const doc = withApp();
      delete (doc.state.global as Record<string, unknown>).metrics;
      return doc;
    };
    expect(reducer(legacy(), addMetric(NOTES)).state.global.metrics).toEqual([NOTES]);
    expect(reducer(legacy(), removeMetric({ id: "x" })).operations.global[1]?.error).toMatch(/No metric/);
    expect(reducer(legacy(), updateMetric({ id: "x" })).operations.global[1]?.error).toMatch(/No metric/);
    expect(reducer(legacy(), reorderMetrics({ metricIds: [] })).state.global.metrics).toEqual([]);
  });

  it("validates keys and fields the same way for the write path", () => {
    expect(isMetricKey("a")).toBe(true);
    expect(isMetricKey(`a${"b".repeat(63)}`)).toBe(true);
    expect(isMetricKey(`a${"b".repeat(64)}`)).toBe(false);
    expect(isMetricKey("notes:v2.total-x_y")).toBe(true);
    expect(metricProblem({ key: "notes", label: "Notes", unit: null, description: null })).toBeNull();
    expect(metricProblem({ key: "notes", label: "Notes" })).toBeNull();
  });
});
