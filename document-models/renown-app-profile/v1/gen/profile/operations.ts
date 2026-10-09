/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { type SignalDispatch } from "document-model";
import type { RenownAppProfileGlobalState } from "../types.js";
import type {
  AddLinkAction,
  RemoveLinkAction,
  ReorderLinksAction,
  SetAppDidAction,
  SetProfileAction,
  SetPublisherDidAction,
  UpdateLinkAction,
} from "./actions.js";

export interface RenownAppProfileProfileOperations {
  setAppDidOperation: (
    state: RenownAppProfileGlobalState,
    action: SetAppDidAction,
    dispatch?: SignalDispatch,
  ) => void;
  setPublisherDidOperation: (
    state: RenownAppProfileGlobalState,
    action: SetPublisherDidAction,
    dispatch?: SignalDispatch,
  ) => void;
  setProfileOperation: (
    state: RenownAppProfileGlobalState,
    action: SetProfileAction,
    dispatch?: SignalDispatch,
  ) => void;
  addLinkOperation: (
    state: RenownAppProfileGlobalState,
    action: AddLinkAction,
    dispatch?: SignalDispatch,
  ) => void;
  updateLinkOperation: (
    state: RenownAppProfileGlobalState,
    action: UpdateLinkAction,
    dispatch?: SignalDispatch,
  ) => void;
  removeLinkOperation: (
    state: RenownAppProfileGlobalState,
    action: RemoveLinkAction,
    dispatch?: SignalDispatch,
  ) => void;
  reorderLinksOperation: (
    state: RenownAppProfileGlobalState,
    action: ReorderLinksAction,
    dispatch?: SignalDispatch,
  ) => void;
}
