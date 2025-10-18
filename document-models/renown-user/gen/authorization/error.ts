export type ErrorCode = "AuthorizationNotFoundError";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class AuthorizationNotFoundError extends Error implements ReducerError {
  errorCode = "AuthorizationNotFoundError" as ErrorCode;
  constructor(message = "AuthorizationNotFoundError") {
    super(message);
  }
}

export const errors = {
  RevokeAuthorization: {
    AuthorizationNotFoundError,
  },
  RemoveAuthorization: {
    AuthorizationNotFoundError,
  },
};
