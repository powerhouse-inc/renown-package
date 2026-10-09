export type ErrorCode =
  | "InvalidAppDidError"
  | "AppDidImmutableError"
  | "InvalidPublisherDidError"
  | "AppDidNotSetError"
  | "InvalidWebsiteError"
  | "InvalidLogoError"
  | "DescriptionTooLongError"
  | "CategoryTooLongError"
  | "InvalidImageRefError"
  | "TooManyLinksError"
  | "DuplicateLinkIdError"
  | "InvalidLinkError"
  | "LinkNotFoundError";

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

export class DescriptionTooLongError extends Error implements ReducerError {
  errorCode = "DescriptionTooLongError" as ErrorCode;
  constructor(message = "DescriptionTooLongError") {
    super(message);
  }
}

export class CategoryTooLongError extends Error implements ReducerError {
  errorCode = "CategoryTooLongError" as ErrorCode;
  constructor(message = "CategoryTooLongError") {
    super(message);
  }
}

export class InvalidImageRefError extends Error implements ReducerError {
  errorCode = "InvalidImageRefError" as ErrorCode;
  constructor(message = "InvalidImageRefError") {
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
  SetAppDid: { InvalidAppDidError, AppDidImmutableError },

  SetPublisherDid: { InvalidPublisherDidError },

  SetProfile: {
    AppDidNotSetError,
    InvalidWebsiteError,
    InvalidLogoError,
    DescriptionTooLongError,
    CategoryTooLongError,
    InvalidImageRefError,
  },

  AddLink: { TooManyLinksError, DuplicateLinkIdError, InvalidLinkError },

  UpdateLink: { LinkNotFoundError },
};
