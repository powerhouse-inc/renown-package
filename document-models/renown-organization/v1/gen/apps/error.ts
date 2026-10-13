export type ErrorCode =
  | "InvalidAppDidError"
  | "DuplicateAppError"
  | "AppNotFoundError";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class InvalidAppDidError extends Error implements ReducerError {
  errorCode = "InvalidAppDidError" as ErrorCode;
  constructor(message = "InvalidAppDidError") {
    super(message);
  }
}

export class DuplicateAppError extends Error implements ReducerError {
  errorCode = "DuplicateAppError" as ErrorCode;
  constructor(message = "DuplicateAppError") {
    super(message);
  }
}

export class AppNotFoundError extends Error implements ReducerError {
  errorCode = "AppNotFoundError" as ErrorCode;
  constructor(message = "AppNotFoundError") {
    super(message);
  }
}

export const errors = {
  AddOrgApp: { InvalidAppDidError, DuplicateAppError },

  RemoveOrgApp: { AppNotFoundError },
};
