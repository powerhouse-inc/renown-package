/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { Action } from "document-model";
import type {
  AddAllowedSubjectInput,
  AddRedirectUriInput,
  RemoveAllowedSubjectInput,
  RemoveRedirectUriInput,
  SetAllowAnySubjectInput,
  SetClientInfoInput,
  SetClientSecretHashInput,
  SetStatusInput,
} from "../types.js";

export type SetClientInfoAction = Action & {
  type: "SET_CLIENT_INFO";
  input: SetClientInfoInput;
};
export type AddRedirectUriAction = Action & {
  type: "ADD_REDIRECT_URI";
  input: AddRedirectUriInput;
};
export type RemoveRedirectUriAction = Action & {
  type: "REMOVE_REDIRECT_URI";
  input: RemoveRedirectUriInput;
};
export type AddAllowedSubjectAction = Action & {
  type: "ADD_ALLOWED_SUBJECT";
  input: AddAllowedSubjectInput;
};
export type RemoveAllowedSubjectAction = Action & {
  type: "REMOVE_ALLOWED_SUBJECT";
  input: RemoveAllowedSubjectInput;
};
export type SetAllowAnySubjectAction = Action & {
  type: "SET_ALLOW_ANY_SUBJECT";
  input: SetAllowAnySubjectInput;
};
export type SetClientSecretHashAction = Action & {
  type: "SET_CLIENT_SECRET_HASH";
  input: SetClientSecretHashInput;
};
export type SetStatusAction = Action & {
  type: "SET_STATUS";
  input: SetStatusInput;
};

export type RenownOidcClientClientAction =
  | SetClientInfoAction
  | AddRedirectUriAction
  | RemoveRedirectUriAction
  | AddAllowedSubjectAction
  | RemoveAllowedSubjectAction
  | SetAllowAnySubjectAction
  | SetClientSecretHashAction
  | SetStatusAction;
