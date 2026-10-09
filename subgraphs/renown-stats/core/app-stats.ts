import type { MetricAggregate } from "../store/types.js";
import type { AppMetric } from "./app-metrics-patch.js";

/** Contributors listed per metric on appStats. */
export const TOP_CONTRIBUTORS = 5;
/** A user is active when the app reported anything about them within this window. */
export const ACTIVE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** A metric's headline value under its aggregation; 0 before anyone reported it. */
export function metricValue(
  aggregation: AppMetric["aggregation"],
  aggregate: MetricAggregate | undefined,
): number {
  if (!aggregate) return 0;
  switch (aggregation) {
    case "SUM":
      return aggregate.sum;
    case "MAX":
      return aggregate.max;
    case "AVG":
      return aggregate.avg;
    case "COUNT_USERS":
      return aggregate.positiveUsers;
  }
}
