/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { type SignalDispatch } from "document-model";
import type { RenownOrganizationGlobalState } from "../types.js";
import type {
  ArchiveOrgAction,
  InitOrganizationAction,
  SetMembersPublicAction,
  SetOrgHandleAction,
  SetOrgListedAction,
  SetOrgProfileAction,
  SetTakenDownAction,
} from "./actions.js";

export interface RenownOrganizationProfileOperations {
  initOrganizationOperation: (
    state: RenownOrganizationGlobalState,
    action: InitOrganizationAction,
    dispatch?: SignalDispatch,
  ) => void;
  setOrgProfileOperation: (
    state: RenownOrganizationGlobalState,
    action: SetOrgProfileAction,
    dispatch?: SignalDispatch,
  ) => void;
  setOrgHandleOperation: (
    state: RenownOrganizationGlobalState,
    action: SetOrgHandleAction,
    dispatch?: SignalDispatch,
  ) => void;
  setOrgListedOperation: (
    state: RenownOrganizationGlobalState,
    action: SetOrgListedAction,
    dispatch?: SignalDispatch,
  ) => void;
  setMembersPublicOperation: (
    state: RenownOrganizationGlobalState,
    action: SetMembersPublicAction,
    dispatch?: SignalDispatch,
  ) => void;
  archiveOrgOperation: (
    state: RenownOrganizationGlobalState,
    action: ArchiveOrgAction,
    dispatch?: SignalDispatch,
  ) => void;
  setTakenDownOperation: (
    state: RenownOrganizationGlobalState,
    action: SetTakenDownAction,
    dispatch?: SignalDispatch,
  ) => void;
}
