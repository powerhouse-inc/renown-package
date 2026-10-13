/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { type SignalDispatch } from "document-model";
import type { RenownOrganizationGlobalState } from "../types.js";
import type {
  AddDomainAction,
  RemoveDomainAction,
  SetDomainStatusAction,
} from "./actions.js";

export interface RenownOrganizationDomainsOperations {
  addDomainOperation: (
    state: RenownOrganizationGlobalState,
    action: AddDomainAction,
    dispatch?: SignalDispatch,
  ) => void;
  setDomainStatusOperation: (
    state: RenownOrganizationGlobalState,
    action: SetDomainStatusAction,
    dispatch?: SignalDispatch,
  ) => void;
  removeDomainOperation: (
    state: RenownOrganizationGlobalState,
    action: RemoveDomainAction,
    dispatch?: SignalDispatch,
  ) => void;
}
