export type ErrorCode = "CredentialNotSuspendedError";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class CredentialNotSuspendedError extends Error implements ReducerError {
  errorCode = "CredentialNotSuspendedError" as ErrorCode;
  constructor(message = "CredentialNotSuspendedError") {
    super(message);
  }
}

export const errors = {
  UnsuspendCredential: { CredentialNotSuspendedError },
};
