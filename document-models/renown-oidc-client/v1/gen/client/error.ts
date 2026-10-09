export type ErrorCode =
  | "EmptyName"
  | "InvalidRedirectUri"
  | "InvalidSubject"
  | "InvalidSecretHash";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class EmptyName extends Error implements ReducerError {
  errorCode = "EmptyName" as ErrorCode;
  constructor(message = "EmptyName") {
    super(message);
  }
}

export class InvalidRedirectUri extends Error implements ReducerError {
  errorCode = "InvalidRedirectUri" as ErrorCode;
  constructor(message = "InvalidRedirectUri") {
    super(message);
  }
}

export class InvalidSubject extends Error implements ReducerError {
  errorCode = "InvalidSubject" as ErrorCode;
  constructor(message = "InvalidSubject") {
    super(message);
  }
}

export class InvalidSecretHash extends Error implements ReducerError {
  errorCode = "InvalidSecretHash" as ErrorCode;
  constructor(message = "InvalidSecretHash") {
    super(message);
  }
}

export const errors = {
  SetClientInfo: { EmptyName },

  AddRedirectUri: { InvalidRedirectUri },

  AddAllowedSubject: { InvalidSubject },

  SetClientSecretHash: { InvalidSecretHash },
};
