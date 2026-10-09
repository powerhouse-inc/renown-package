export type ErrorCode =
  | "InvalidAppDidError"
  | "AppDidImmutableError"
  | "InvalidPublisherDidError"
  | "AppDidNotSetError"
  | "InvalidWebsiteError"
  | "InvalidLogoError";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class InvalidAppDidError extends Error implements ReducerError {
  errorCode = "InvalidAppDidError" as ErrorCode;
  constructor(message = "InvalidAppDidError") {
    super(message);
  }
}

export class AppDidImmutableError extends Error implements ReducerError {
  errorCode = "AppDidImmutableError" as ErrorCode;
  constructor(message = "AppDidImmutableError") {
    super(message);
  }
}

export class InvalidPublisherDidError extends Error implements ReducerError {
  errorCode = "InvalidPublisherDidError" as ErrorCode;
  constructor(message = "InvalidPublisherDidError") {
    super(message);
  }
}

export class AppDidNotSetError extends Error implements ReducerError {
  errorCode = "AppDidNotSetError" as ErrorCode;
  constructor(message = "AppDidNotSetError") {
    super(message);
  }
}

export class InvalidWebsiteError extends Error implements ReducerError {
  errorCode = "InvalidWebsiteError" as ErrorCode;
  constructor(message = "InvalidWebsiteError") {
    super(message);
  }
}

export class InvalidLogoError extends Error implements ReducerError {
  errorCode = "InvalidLogoError" as ErrorCode;
  constructor(message = "InvalidLogoError") {
    super(message);
  }
}

export const errors = {
  SetAppDid: { InvalidAppDidError, AppDidImmutableError },

  SetPublisherDid: { InvalidPublisherDidError },

  SetProfile: { AppDidNotSetError, InvalidWebsiteError, InvalidLogoError },
};
