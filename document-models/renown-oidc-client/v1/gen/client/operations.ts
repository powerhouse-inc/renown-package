/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { type SignalDispatch } from "document-model";
import type { RenownOidcClientGlobalState } from "../types.js";
import type {
  AddAllowedSubjectAction,
  AddRedirectUriAction,
  RemoveAllowedSubjectAction,
  RemoveRedirectUriAction,
  SetAllowAnySubjectAction,
  SetClientInfoAction,
  SetClientSecretHashAction,
  SetStatusAction,
} from "./actions.js";

export interface RenownOidcClientClientOperations {
  setClientInfoOperation: (
    state: RenownOidcClientGlobalState,
    action: SetClientInfoAction,
    dispatch?: SignalDispatch,
  ) => void;
  addRedirectUriOperation: (
    state: RenownOidcClientGlobalState,
    action: AddRedirectUriAction,
    dispatch?: SignalDispatch,
  ) => void;
  removeRedirectUriOperation: (
    state: RenownOidcClientGlobalState,
    action: RemoveRedirectUriAction,
    dispatch?: SignalDispatch,
  ) => void;
  addAllowedSubjectOperation: (
    state: RenownOidcClientGlobalState,
    action: AddAllowedSubjectAction,
    dispatch?: SignalDispatch,
  ) => void;
  removeAllowedSubjectOperation: (
    state: RenownOidcClientGlobalState,
    action: RemoveAllowedSubjectAction,
    dispatch?: SignalDispatch,
  ) => void;
  setAllowAnySubjectOperation: (
    state: RenownOidcClientGlobalState,
    action: SetAllowAnySubjectAction,
    dispatch?: SignalDispatch,
  ) => void;
  setClientSecretHashOperation: (
    state: RenownOidcClientGlobalState,
    action: SetClientSecretHashAction,
    dispatch?: SignalDispatch,
  ) => void;
  setStatusOperation: (
    state: RenownOidcClientGlobalState,
    action: SetStatusAction,
    dispatch?: SignalDispatch,
  ) => void;
}
