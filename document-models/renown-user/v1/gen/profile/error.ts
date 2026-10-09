export type ErrorCode =
  | "DisplayNameLengthError"
  | "InvalidHandleError"
  | "BioTooLongError"
  | "InvalidAvatarRefError"
  | "TooManyLinksError"
  | "DuplicateLinkIdError"
  | "InvalidLinkError"
  | "LinkNotFoundError";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class DisplayNameLengthError extends Error implements ReducerError {
  errorCode = "DisplayNameLengthError" as ErrorCode;
  constructor(message = "DisplayNameLengthError") {
    super(message);
  }
}

export class InvalidHandleError extends Error implements ReducerError {
  errorCode = "InvalidHandleError" as ErrorCode;
  constructor(message = "InvalidHandleError") {
    super(message);
  }
}

export class BioTooLongError extends Error implements ReducerError {
  errorCode = "BioTooLongError" as ErrorCode;
  constructor(message = "BioTooLongError") {
    super(message);
  }
}

export class InvalidAvatarRefError extends Error implements ReducerError {
  errorCode = "InvalidAvatarRefError" as ErrorCode;
  constructor(message = "InvalidAvatarRefError") {
    super(message);
  }
}

export class TooManyLinksError extends Error implements ReducerError {
  errorCode = "TooManyLinksError" as ErrorCode;
  constructor(message = "TooManyLinksError") {
    super(message);
  }
}

export class DuplicateLinkIdError extends Error implements ReducerError {
  errorCode = "DuplicateLinkIdError" as ErrorCode;
  constructor(message = "DuplicateLinkIdError") {
    super(message);
  }
}

export class InvalidLinkError extends Error implements ReducerError {
  errorCode = "InvalidLinkError" as ErrorCode;
  constructor(message = "InvalidLinkError") {
    super(message);
  }
}

export class LinkNotFoundError extends Error implements ReducerError {
  errorCode = "LinkNotFoundError" as ErrorCode;
  constructor(message = "LinkNotFoundError") {
    super(message);
  }
}

export const errors = {
  SetDisplayName: { DisplayNameLengthError },

  SetHandle: { InvalidHandleError },

  SetBio: { BioTooLongError },

  SetAvatar: { InvalidAvatarRefError },

  AddLink: { TooManyLinksError, DuplicateLinkIdError, InvalidLinkError },

  UpdateLink: { LinkNotFoundError },
};
