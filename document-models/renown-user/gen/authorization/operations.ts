import { type SignalDispatch } from "document-model";
import {
  type AddAuthorizationAction,
  type RevokeAuthorizationAction,
  type RemoveAuthorizationAction,
} from "./actions.js";
import { type RenownUserState } from "../types.js";

export interface RenownUserAuthorizationOperations {
  addAuthorizationOperation: (
    state: RenownUserState,
    action: AddAuthorizationAction,
    dispatch?: SignalDispatch,
  ) => void;
  revokeAuthorizationOperation: (
    state: RenownUserState,
    action: RevokeAuthorizationAction,
    dispatch?: SignalDispatch,
  ) => void;
  removeAuthorizationOperation: (
    state: RenownUserState,
    action: RemoveAuthorizationAction,
    dispatch?: SignalDispatch,
  ) => void;
}
