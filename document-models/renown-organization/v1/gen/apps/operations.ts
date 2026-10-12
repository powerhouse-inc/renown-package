/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { type SignalDispatch } from "document-model";
import type { RenownOrganizationGlobalState } from "../types.js";
import type {
  AddOrgAppAction,
  RemoveOrgAppAction,
  SetAppFrozenAction,
} from "./actions.js";

export interface RenownOrganizationAppsOperations {
  addOrgAppOperation: (
    state: RenownOrganizationGlobalState,
    action: AddOrgAppAction,
    dispatch?: SignalDispatch,
  ) => void;
  removeOrgAppOperation: (
    state: RenownOrganizationGlobalState,
    action: RemoveOrgAppAction,
    dispatch?: SignalDispatch,
  ) => void;
  setAppFrozenOperation: (
    state: RenownOrganizationGlobalState,
    action: SetAppFrozenAction,
    dispatch?: SignalDispatch,
  ) => void;
}
