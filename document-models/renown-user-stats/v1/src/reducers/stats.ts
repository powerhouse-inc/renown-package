import type { RenownUserStatsStatsOperations } from "document-models/renown-user-stats/v1";
import {
  DuplicateStatIdError,
  InvalidAppDidError,
  InvalidMetricError,
  InvalidUserDidError,
  TooManyMetricsError,
  UserDidImmutableError,
  UserDidNotSetError,
} from "../../gen/stats/error.js";
import {
  isAppDid,
  isMetricName,
  isUserDid,
  MAX_METRICS_PER_APP,
} from "../utils.js";

export const renownUserStatsStatsOperations: RenownUserStatsStatsOperations = {
  setUserDidOperation(state, action) {
    const { userDid } = action.input;
    if (!isUserDid(userDid)) {
      throw new InvalidUserDidError(`Invalid user DID: ${userDid}`);
    }
    if (state.userDid && state.userDid !== userDid) {
      throw new UserDidImmutableError(
        `This document belongs to ${state.userDid}`,
      );
    }
    state.userDid = userDid;
  },
  setStatOperation(state, action) {
    const { id, appDid, metric, value, updatedAt } = action.input;
    if (!state.userDid) {
      throw new UserDidNotSetError("Set the user DID before reporting stats");
    }
    if (!isAppDid(appDid)) {
      throw new InvalidAppDidError(`Invalid app DID: ${appDid}`);
    }
    if (!isMetricName(metric)) {
      throw new InvalidMetricError(`Invalid metric name: ${metric}`);
    }
    const existing = state.stats.find(
      (s) => s.appDid === appDid && s.metric === metric,
    );
    if (existing) {
      // Current-value semantics: an older report is a late retry, not news.
      if (Date.parse(updatedAt) < Date.parse(existing.updatedAt)) return;
      existing.value = value;
      existing.updatedAt = updatedAt;
      return;
    }
    if (state.stats.some((s) => s.id === id)) {
      throw new DuplicateStatIdError(`Stat id ${id} is already used`);
    }
    if (
      state.stats.filter((s) => s.appDid === appDid).length >=
      MAX_METRICS_PER_APP
    ) {
      throw new TooManyMetricsError(
        `App ${appDid} already reports ${MAX_METRICS_PER_APP} metrics`,
      );
    }
    state.stats.push({ id, appDid, metric, value, updatedAt });
  },
};
