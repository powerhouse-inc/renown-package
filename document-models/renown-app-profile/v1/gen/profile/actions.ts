/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { Action } from "document-model";
import type {
  SetAppDidInput,
  SetProfileInput,
  SetPublisherDidInput,
} from "../types.js";

export type SetAppDidAction = Action & {
  type: "SET_APP_DID";
  input: SetAppDidInput;
};
export type SetPublisherDidAction = Action & {
  type: "SET_PUBLISHER_DID";
  input: SetPublisherDidInput;
};
export type SetProfileAction = Action & {
  type: "SET_PROFILE";
  input: SetProfileInput;
};

export type RenownAppProfileProfileAction =
  | SetAppDidAction
  | SetPublisherDidAction
  | SetProfileAction;
