export type ErrorCode =
  | "InvalidDomainError"
  | "DuplicateDomainError"
  | "DomainNotFoundError";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class InvalidDomainError extends Error implements ReducerError {
  errorCode = "InvalidDomainError" as ErrorCode;
  constructor(message = "InvalidDomainError") {
    super(message);
  }
}

export class DuplicateDomainError extends Error implements ReducerError {
  errorCode = "DuplicateDomainError" as ErrorCode;
  constructor(message = "DuplicateDomainError") {
    super(message);
  }
}

export class DomainNotFoundError extends Error implements ReducerError {
  errorCode = "DomainNotFoundError" as ErrorCode;
  constructor(message = "DomainNotFoundError") {
    super(message);
  }
}

export const errors = {
  AddDomain: { InvalidDomainError, DuplicateDomainError },

  SetDomainStatus: { DomainNotFoundError },
};
