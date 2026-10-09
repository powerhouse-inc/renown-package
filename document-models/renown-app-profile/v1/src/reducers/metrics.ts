import type {
  RenownAppMetric,
  RenownAppProfileMetricsOperations,
  RenownAppProfileState,
} from "document-models/renown-app-profile/v1";
import {
  DuplicateMetricIdError,
  DuplicateMetricKeyError,
  InvalidMetricError,
  MetricNotFoundError,
  TooManyMetricsError,
} from "../../gen/metrics/error.js";
import { MAX_METRICS, metricProblem } from "../utils.js";

/** Trimmed; empty (or whitespace only) means none. */
function optionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/**
 * The profile's metrics. Profiles created before metrics existed carry no
 * `metrics` key at all; they are treated as empty and the list is created on
 * first write.
 */
function metricsOf(state: RenownAppProfileState): RenownAppMetric[] {
  const legacy = state as { metrics?: RenownAppMetric[] };
  legacy.metrics ??= [];
  return legacy.metrics;
}

function findMetric(metrics: RenownAppMetric[], id: string): RenownAppMetric {
  const metric = metrics.find((m) => m.id === id);
  if (!metric) throw new MetricNotFoundError(`No metric with id ${id}`);
  return metric;
}

/** InvalidMetricError or DuplicateMetricKeyError unless `metric` may join `metrics`. */
function assertAcceptable(metrics: RenownAppMetric[], metric: RenownAppMetric): void {
  const problem = metricProblem(metric);
  if (problem) throw new InvalidMetricError(problem);
  if (metrics.some((m) => m.key === metric.key && m.id !== metric.id)) {
    throw new DuplicateMetricKeyError(`Metric key ${metric.key} is already declared`);
  }
}

export const renownAppProfileMetricsOperations: RenownAppProfileMetricsOperations =
  {
    addMetricOperation(state, action) {
      const input = action.input;
      const metrics = metricsOf(state);
      if (metrics.some((m) => m.id === input.id)) {
        throw new DuplicateMetricIdError(`Metric id ${input.id} is already used`);
      }
      if (metrics.length >= MAX_METRICS) {
        throw new TooManyMetricsError(
          `A profile declares at most ${MAX_METRICS} metrics`,
        );
      }
      const metric: RenownAppMetric = {
        id: input.id,
        key: input.key,
        label: input.label.trim(),
        unit: optionalText(input.unit),
        description: optionalText(input.description),
        aggregation: input.aggregation,
        public: input.public,
      };
      assertAcceptable(metrics, metric);
      metrics.push(metric);
    },
    updateMetricOperation(state, action) {
      const input = action.input;
      const metrics = metricsOf(state);
      const current = findMetric(metrics, input.id);
      const next: RenownAppMetric = {
        id: current.id,
        key: input.key ?? current.key,
        label: input.label != null ? input.label.trim() : current.label,
        unit: input.unit != null ? optionalText(input.unit) : current.unit,
        description:
          input.description != null
            ? optionalText(input.description)
            : current.description,
        aggregation: input.aggregation ?? current.aggregation,
        public: input.public ?? current.public,
      };
      assertAcceptable(metrics, next);
      Object.assign(current, next);
    },
    removeMetricOperation(state, action) {
      const metrics = metricsOf(state);
      const index = metrics.findIndex((m) => m.id === action.input.id);
      if (index === -1) {
        throw new MetricNotFoundError(`No metric with id ${action.input.id}`);
      }
      metrics.splice(index, 1);
    },
    reorderMetricsOperation(state, action) {
      const metrics = metricsOf(state);
      const front: RenownAppMetric[] = [];
      for (const id of action.input.metricIds) {
        const metric = findMetric(metrics, id);
        if (!front.includes(metric)) front.push(metric);
      }
      state.metrics = [...front, ...metrics.filter((m) => !front.includes(m))];
    },
  };
