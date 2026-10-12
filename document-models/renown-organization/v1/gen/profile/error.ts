export type ErrorCode =
  | "AlreadyInitializedError"
  | "InvalidHandleError"
  | "NameLengthError"
  | "BioTooLongError"
  | "InvalidWebsiteError"
  | "InvalidAvatarError"
  | "TooManyLinksError"
  | "InvalidLinkError";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class AlreadyInitializedError extends Error implements ReducerError {
  errorCode = "AlreadyInitializedError" as ErrorCode;
  constructor(message = "AlreadyInitializedError") {
    super(message);
  }
}

export class InvalidHandleError extends Error implements ReducerError {
  errorCode = "InvalidHandleError" as ErrorCode;
  constructor(message = "InvalidHandleError") {
    super(message);
  }
}

export class NameLengthError extends Error implements ReducerError {
  errorCode = "NameLengthError" as ErrorCode;
  constructor(message = "NameLengthError") {
    super(message);
  }
}

export class BioTooLongError extends Error implements ReducerError {
  errorCode = "BioTooLongError" as ErrorCode;
  constructor(message = "BioTooLongError") {
    super(message);
  }
}

export class InvalidWebsiteError extends Error implements ReducerError {
  errorCode = "InvalidWebsiteError" as ErrorCode;
  constructor(message = "InvalidWebsiteError") {
    super(message);
  }
}

export class InvalidAvatarError extends Error implements ReducerError {
  errorCode = "InvalidAvatarError" as ErrorCode;
  constructor(message = "InvalidAvatarError") {
    super(message);
  }
}

export class TooManyLinksError extends Error implements ReducerError {
  errorCode = "TooManyLinksError" as ErrorCode;
  constructor(message = "TooManyLinksError") {
    super(message);
  }
}

export class InvalidLinkError extends Error implements ReducerError {
  errorCode = "InvalidLinkError" as ErrorCode;
  constructor(message = "InvalidLinkError") {
    super(message);
  }
}

export const errors = {
  InitOrganization: {
    AlreadyInitializedError,
    InvalidHandleError,
    NameLengthError,
  },

  SetOrgProfile: {
    BioTooLongError,
    InvalidWebsiteError,
    InvalidAvatarError,
    TooManyLinksError,
    InvalidLinkError,
  },
};
