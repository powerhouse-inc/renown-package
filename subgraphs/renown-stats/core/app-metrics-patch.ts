import type { Action } from "document-model";
import {
  actions as appActions,
  isMetricKey,
  MAX_METRIC_DESCRIPTION_LENGTH,
  MAX_METRIC_LABEL_LENGTH,
  MAX_METRIC_UNIT_LENGTH,
  MAX_METRICS,
  METRIC_AGGREGATIONS,
  type RenownAppMetric,
  type RenownMetricAggregation,
} from "../../../document-models/renown-app-profile/index.js";
import { AppProfileInputError } from "./app-profile-patch.js";

/** One metric as upsertAppProfile receives it (AppMetricInput). */
export interface AppMetricInput {
  id: string;
  key: string;
  label: string;
  unit?: string | null;
  description?: string | null;
  aggregation: string;
  public: boolean;
}

/** A validated, trimmed metric definition; null unit/description means none. */
export interface AppMetric {
  id: string;
  key: string;
  label: string;
  unit: string | null;
  description: string | null;
  aggregation: RenownMetricAggregation;
  public: boolean;
}

const AGGREGATIONS: ReadonlySet<string> = new Set(METRIC_AGGREGATIONS);

function isAggregation(value: string): value is RenownMetricAggregation {
  return AGGREGATIONS.has(value);
}

function optionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

const bad = (message: string) => new AppProfileInputError("metrics", message);

/** A stored metric as the API returns it. */
export function toAppMetric(metric: RenownAppMetric): AppMetric {
  return {
    id: metric.id,
    key: metric.key,
    label: metric.label,
    unit: metric.unit ?? null,
    description: metric.description ?? null,
    aggregation: metric.aggregation,
    public: metric.public,
  };
}

/**
 * The validated whole desired list, or undefined when `input` is absent/null
 * (unchanged). Mirrors the model's rules so a bad list fails before any write.
 * @throws {AppProfileInputError} with field "metrics".
 */
export function toMetricsPatch(
  input: readonly AppMetricInput[] | null | undefined,
): AppMetric[] | undefined {
  if (input == null) return undefined;
  if (input.length > MAX_METRICS) throw bad(`A profile declares at most ${MAX_METRICS} metrics`);
  const ids = new Set<string>();
  const keys = new Set<string>();
  return input.map((raw) => {
    const key = raw.key.trim();
    const label = raw.label.trim();
    const unit = optionalText(raw.unit);
    const description = optionalText(raw.description);
    if (!raw.id || ids.has(raw.id)) throw bad("Every metric needs a unique id");
    if (!isMetricKey(key)) {
      throw bad(`Metric key "${key}" must start with a letter and use only letters, digits and _ . : - (at most 64)`);
    }
    if (keys.has(key)) throw bad(`Metric key "${key}" is declared twice`);
    if (label === "" || label.length > MAX_METRIC_LABEL_LENGTH) {
      throw bad(`Metric labels must be 1-${MAX_METRIC_LABEL_LENGTH} characters`);
    }
    if (unit !== null && unit.length > MAX_METRIC_UNIT_LENGTH) {
      throw bad(`Metric units must be at most ${MAX_METRIC_UNIT_LENGTH} characters`);
    }
    if (description !== null && description.length > MAX_METRIC_DESCRIPTION_LENGTH) {
      throw bad(`Metric descriptions must be at most ${MAX_METRIC_DESCRIPTION_LENGTH} characters`);
    }
    if (!isAggregation(raw.aggregation)) throw bad("aggregation must be SUM, MAX, AVG or COUNT_USERS");
    ids.add(raw.id);
    keys.add(key);
    return { id: raw.id, key, label, unit, description, aggregation: raw.aggregation, public: raw.public };
  });
}

function differs(a: AppMetric, b: AppMetric): boolean {
  return (
    a.label !== b.label ||
    a.unit !== b.unit ||
    a.description !== b.description ||
    a.aggregation !== b.aggregation ||
    a.public !== b.public
  );
}

/**
 * The renown-app-profile operations that turn `current` into `desired`:
 * removes (including every metric whose key changes), then updates, then
 * adds, then one reorder if the order still differs. A key change is a
 * remove + add with the same id, so keys can be swapped in one save without
 * a transient DuplicateMetricKeyError.
 */
export function metricActions(
  current: readonly AppMetric[],
  desired: readonly AppMetric[],
): Action[] {
  const wanted = new Map(desired.map((metric) => [metric.id, metric]));
  const removes: Action[] = [];
  const updates: Action[] = [];
  const kept: string[] = [];
  for (const metric of current) {
    const next = wanted.get(metric.id);
    if (!next || next.key !== metric.key) {
      removes.push(appActions.removeMetric({ id: metric.id }));
      continue;
    }
    kept.push(metric.id);
    if (differs(metric, next)) {
      updates.push(
        appActions.updateMetric({
          id: next.id,
          label: next.label,
          unit: next.unit ?? "",
          description: next.description ?? "",
          aggregation: next.aggregation,
          public: next.public,
        }),
      );
    }
  }
  const adds: Action[] = [];
  const order = [...kept];
  for (const next of desired) {
    if (kept.includes(next.id)) continue;
    adds.push(
      appActions.addMetric({
        id: next.id,
        key: next.key,
        label: next.label,
        unit: next.unit,
        description: next.description,
        aggregation: next.aggregation,
        public: next.public,
      }),
    );
    order.push(next.id);
  }
  const target = desired.map((metric) => metric.id);
  const reorder =
    order.join("\u0000") === target.join("\u0000")
      ? []
      : [appActions.reorderMetrics({ metricIds: target })];
  return [...removes, ...updates, ...adds, ...reorder];
}
