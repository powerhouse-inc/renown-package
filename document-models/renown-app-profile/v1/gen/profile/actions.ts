/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { Action } from "document-model";
import type {
  AddLinkInput,
  RemoveLinkInput,
  ReorderLinksInput,
  SetAppDidInput,
  SetProfileInput,
  SetPublisherDidInput,
  UpdateLinkInput,
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
export type AddLinkAction = Action & { type: "ADD_LINK"; input: AddLinkInput };
export type UpdateLinkAction = Action & {
  type: "UPDATE_LINK";
  input: UpdateLinkInput;
};
export type RemoveLinkAction = Action & {
  type: "REMOVE_LINK";
  input: RemoveLinkInput;
};
export type ReorderLinksAction = Action & {
  type: "REORDER_LINKS";
  input: ReorderLinksInput;
};

export type RenownAppProfileProfileAction =
  | SetAppDidAction
  | SetPublisherDidAction
  | SetProfileAction
  | AddLinkAction
  | UpdateLinkAction
  | RemoveLinkAction
  | ReorderLinksAction;
