/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { Action } from "document-model";
import type {
  AddOrgAppInput,
  RemoveOrgAppInput,
  SetAppFrozenInput,
} from "../types.js";

export type AddOrgAppAction = Action & {
  type: "ADD_ORG_APP";
  input: AddOrgAppInput;
};
export type RemoveOrgAppAction = Action & {
  type: "REMOVE_ORG_APP";
  input: RemoveOrgAppInput;
};
export type SetAppFrozenAction = Action & {
  type: "SET_APP_FROZEN";
  input: SetAppFrozenInput;
};

export type RenownOrganizationAppsAction =
  | AddOrgAppAction
  | RemoveOrgAppAction
  | SetAppFrozenAction;
