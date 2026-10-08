/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { type SignalDispatch } from "document-model";
import type { RenownUserStatsGlobalState } from "../types.js";
import type { SetStatAction, SetUserDidAction } from "./actions.js";

export interface RenownUserStatsStatsOperations {
  setUserDidOperation: (
    state: RenownUserStatsGlobalState,
    action: SetUserDidAction,
    dispatch?: SignalDispatch,
  ) => void;
  setStatOperation: (
    state: RenownUserStatsGlobalState,
    action: SetStatAction,
    dispatch?: SignalDispatch,
  ) => void;
}
