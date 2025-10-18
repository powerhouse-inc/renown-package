import { type Action } from "document-model";
import type {
  AddAuthorizationInput,
  RevokeAuthorizationInput,
  RemoveAuthorizationInput,
} from "../types.js";

export type AddAuthorizationAction = Action & {
  type: "ADD_AUTHORIZATION";
  input: AddAuthorizationInput;
};
export type RevokeAuthorizationAction = Action & {
  type: "REVOKE_AUTHORIZATION";
  input: RevokeAuthorizationInput;
};
export type RemoveAuthorizationAction = Action & {
  type: "REMOVE_AUTHORIZATION";
  input: RemoveAuthorizationInput;
};

export type RenownUserAuthorizationAction =
  | AddAuthorizationAction
  | RevokeAuthorizationAction
  | RemoveAuthorizationAction;
