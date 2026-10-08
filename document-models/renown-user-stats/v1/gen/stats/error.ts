export type ErrorCode =
  | "InvalidUserDidError"
  | "UserDidImmutableError"
  | "UserDidNotSetError"
  | "InvalidAppDidError"
  | "InvalidMetricError"
  | "DuplicateStatIdError"
  | "TooManyMetricsError";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class InvalidUserDidError extends Error implements ReducerError {
  errorCode = "InvalidUserDidError" as ErrorCode;
  constructor(message = "InvalidUserDidError") {
    super(message);
  }
}

export class UserDidImmutableError extends Error implements ReducerError {
  errorCode = "UserDidImmutableError" as ErrorCode;
  constructor(message = "UserDidImmutableError") {
    super(message);
  }
}

export class UserDidNotSetError extends Error implements ReducerError {
  errorCode = "UserDidNotSetError" as ErrorCode;
  constructor(message = "UserDidNotSetError") {
    super(message);
  }
}

export class InvalidAppDidError extends Error implements ReducerError {
  errorCode = "InvalidAppDidError" as ErrorCode;
  constructor(message = "InvalidAppDidError") {
    super(message);
  }
}

export class InvalidMetricError extends Error implements ReducerError {
  errorCode = "InvalidMetricError" as ErrorCode;
  constructor(message = "InvalidMetricError") {
    super(message);
  }
}

export class DuplicateStatIdError extends Error implements ReducerError {
  errorCode = "DuplicateStatIdError" as ErrorCode;
  constructor(message = "DuplicateStatIdError") {
    super(message);
  }
}

export class TooManyMetricsError extends Error implements ReducerError {
  errorCode = "TooManyMetricsError" as ErrorCode;
  constructor(message = "TooManyMetricsError") {
    super(message);
  }
}

export const errors = {
  SetUserDid: { InvalidUserDidError, UserDidImmutableError },

  SetStat: {
    UserDidNotSetError,
    InvalidAppDidError,
    InvalidMetricError,
    DuplicateStatIdError,
    TooManyMetricsError,
  },
};
