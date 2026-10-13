import { GraphQLError } from "graphql";

/** The only extensions.code values renown-orgs answers with. */
export type OrgErrorCode =
  | "BAD_USER_INPUT"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "HANDLE_TAKEN"
  | "HANDLE_RESERVED"
  | "LAST_OWNER"
  | "LIMIT_REACHED"
  | "DOMAIN_TAKEN"
  | "DOMAIN_PROOF_MISSING"
  | "ORG_HAS_APPS"
  | "APP_FROZEN"
  | "PROPOSAL_NOT_EXECUTABLE"
  | "RATE_LIMITED"
  | "SERVICE_UNAVAILABLE";

export function orgError(code: OrgErrorCode, message: string, field?: string): GraphQLError {
  return new GraphQLError(message, { extensions: field ? { code, field } : { code } });
}

export function forbidden(message = "Forbidden"): GraphQLError {
  return orgError("FORBIDDEN", message);
}

export function notFound(what: string): GraphQLError {
  return orgError("NOT_FOUND", `${what} not found`);
}

/** An argument the caller must fix; `field` names it so a form can show the error inline. */
export function badInput(field: string, message: string): GraphQLError {
  return orgError("BAD_USER_INPUT", message, field);
}

export function limitReached(message: string): GraphQLError {
  return orgError("LIMIT_REACHED", message);
}

export function rateLimited(): GraphQLError {
  return orgError("RATE_LIMITED", "Rate limited");
}

export function unavailable(message = "Organizations are temporarily unavailable"): GraphQLError {
  return orgError("SERVICE_UNAVAILABLE", message);
}
