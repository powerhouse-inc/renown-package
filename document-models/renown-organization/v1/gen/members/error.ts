export type ErrorCode =
  | "DuplicateMemberError"
  | "MemberNotFoundError"
  | "InvalidStatusTransitionError"
  | "LastOwnerError"
  | "TooManyMembersError"
  | "MemberNotActiveError"
  | "InvalidAppDidError"
  | "DuplicateTeamIdError"
  | "TooManyTeamsError"
  | "InvalidTeamError"
  | "DuplicateTeamSlugError"
  | "TeamNotFoundError";

export interface ReducerError {
  errorCode: ErrorCode;
}

export class DuplicateMemberError extends Error implements ReducerError {
  errorCode = "DuplicateMemberError" as ErrorCode;
  constructor(message = "DuplicateMemberError") {
    super(message);
  }
}

export class MemberNotFoundError extends Error implements ReducerError {
  errorCode = "MemberNotFoundError" as ErrorCode;
  constructor(message = "MemberNotFoundError") {
    super(message);
  }
}

export class InvalidStatusTransitionError
  extends Error
  implements ReducerError
{
  errorCode = "InvalidStatusTransitionError" as ErrorCode;
  constructor(message = "InvalidStatusTransitionError") {
    super(message);
  }
}

export class LastOwnerError extends Error implements ReducerError {
  errorCode = "LastOwnerError" as ErrorCode;
  constructor(message = "LastOwnerError") {
    super(message);
  }
}

export class TooManyMembersError extends Error implements ReducerError {
  errorCode = "TooManyMembersError" as ErrorCode;
  constructor(message = "TooManyMembersError") {
    super(message);
  }
}

export class MemberNotActiveError extends Error implements ReducerError {
  errorCode = "MemberNotActiveError" as ErrorCode;
  constructor(message = "MemberNotActiveError") {
    super(message);
  }
}

export class InvalidAppDidError extends Error implements ReducerError {
  errorCode = "InvalidAppDidError" as ErrorCode;
  constructor(message = "InvalidAppDidError") {
    super(message);
  }
}

export class DuplicateTeamIdError extends Error implements ReducerError {
  errorCode = "DuplicateTeamIdError" as ErrorCode;
  constructor(message = "DuplicateTeamIdError") {
    super(message);
  }
}

export class TooManyTeamsError extends Error implements ReducerError {
  errorCode = "TooManyTeamsError" as ErrorCode;
  constructor(message = "TooManyTeamsError") {
    super(message);
  }
}

export class InvalidTeamError extends Error implements ReducerError {
  errorCode = "InvalidTeamError" as ErrorCode;
  constructor(message = "InvalidTeamError") {
    super(message);
  }
}

export class DuplicateTeamSlugError extends Error implements ReducerError {
  errorCode = "DuplicateTeamSlugError" as ErrorCode;
  constructor(message = "DuplicateTeamSlugError") {
    super(message);
  }
}

export class TeamNotFoundError extends Error implements ReducerError {
  errorCode = "TeamNotFoundError" as ErrorCode;
  constructor(message = "TeamNotFoundError") {
    super(message);
  }
}

export const errors = {
  InviteMember: { DuplicateMemberError },

  SetMemberStatus: {
    MemberNotFoundError,
    InvalidStatusTransitionError,
    LastOwnerError,
    TooManyMembersError,
  },

  SetMemberRole: { MemberNotActiveError },

  SetMemberAppScope: { InvalidAppDidError },

  AddTeam: {
    DuplicateTeamIdError,
    TooManyTeamsError,
    InvalidTeamError,
    DuplicateTeamSlugError,
  },

  UpdateTeam: { TeamNotFoundError },
};
