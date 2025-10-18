import type { RenownUserProfileAction } from "./profile/actions.js";
import type { RenownUserAuthorizationAction } from "./authorization/actions.js";

export * from "./profile/actions.js";
export * from "./authorization/actions.js";

export type RenownUserAction =
  | RenownUserProfileAction
  | RenownUserAuthorizationAction;
