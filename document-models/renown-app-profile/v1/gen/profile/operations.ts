/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { type SignalDispatch } from "document-model";
import type { RenownAppProfileGlobalState } from "../types.js";
import type {
  SetAppDidAction,
  SetProfileAction,
  SetPublisherDidAction,
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
}
