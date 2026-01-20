export type ErrorCode =
  | "MissingContextError"
  | "MissingTypeError"
  | "InvalidClaimsError"
  | "AlreadyRevokedError"
  | "CredentialRevokedError"
  | "InvalidStatusPurposeError";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class MissingContextError extends Error implements ReducerError {
  errorCode = "MissingContextError" as ErrorCode;
  constructor(message = "MissingContextError") {
    super(message);
  }
}

export class MissingTypeError extends Error implements ReducerError {
  errorCode = "MissingTypeError" as ErrorCode;
  constructor(message = "MissingTypeError") {
    super(message);
  }
}

export class InvalidClaimsError extends Error implements ReducerError {
  errorCode = "InvalidClaimsError" as ErrorCode;
  constructor(message = "InvalidClaimsError") {
    super(message);
  }
}

export class AlreadyRevokedError extends Error implements ReducerError {
  errorCode = "AlreadyRevokedError" as ErrorCode;
  constructor(message = "AlreadyRevokedError") {
    super(message);
  }
}

export class CredentialRevokedError extends Error implements ReducerError {
  errorCode = "CredentialRevokedError" as ErrorCode;
  constructor(message = "CredentialRevokedError") {
    super(message);
  }
}

export class InvalidStatusPurposeError extends Error implements ReducerError {
  errorCode = "InvalidStatusPurposeError" as ErrorCode;
  constructor(message = "InvalidStatusPurposeError") {
    super(message);
  }
}

export const errors = {
  Init: { MissingContextError, MissingTypeError, InvalidClaimsError },
  Revoke: { AlreadyRevokedError },
  UpdateCredentialSubject: { InvalidClaimsError, CredentialRevokedError },
  SetCredentialStatus: { InvalidStatusPurposeError },
};
