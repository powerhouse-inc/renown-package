export type ErrorCode =
  | "TooManyMetricsError"
  | "DuplicateMetricIdError"
  | "DuplicateMetricKeyError"
  | "InvalidMetricError"
  | "MetricNotFoundError";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class TooManyMetricsError extends Error implements ReducerError {
  errorCode = "TooManyMetricsError" as ErrorCode;
  constructor(message = "TooManyMetricsError") {
    super(message);
  }
}

export class DuplicateMetricIdError extends Error implements ReducerError {
  errorCode = "DuplicateMetricIdError" as ErrorCode;
  constructor(message = "DuplicateMetricIdError") {
    super(message);
  }
}

export class DuplicateMetricKeyError extends Error implements ReducerError {
  errorCode = "DuplicateMetricKeyError" as ErrorCode;
  constructor(message = "DuplicateMetricKeyError") {
    super(message);
  }
}

export class InvalidMetricError extends Error implements ReducerError {
  errorCode = "InvalidMetricError" as ErrorCode;
  constructor(message = "InvalidMetricError") {
    super(message);
  }
}

export class MetricNotFoundError extends Error implements ReducerError {
  errorCode = "MetricNotFoundError" as ErrorCode;
  constructor(message = "MetricNotFoundError") {
    super(message);
  }
}

export const errors = {
  AddMetric: {
    TooManyMetricsError,
    DuplicateMetricIdError,
    DuplicateMetricKeyError,
    InvalidMetricError,
  },

  UpdateMetric: { MetricNotFoundError },
};
