import { type SignalDispatch } from "document-model";
import type {
  InitAction,
  RevokeAction,
  UpdateCredentialSubjectAction,
  SetJwtAction,
  SetCredentialStatusAction,
} from "./actions.js";
import type { RenownCredentialState } from "../types.js";

export interface RenownCredentialManagerOperations {
  initOperation: (
    state: RenownCredentialState,
    action: InitAction,
    dispatch?: SignalDispatch,
  ) => void;
  revokeOperation: (
    state: RenownCredentialState,
    action: RevokeAction,
    dispatch?: SignalDispatch,
  ) => void;
  updateCredentialSubjectOperation: (
    state: RenownCredentialState,
    action: UpdateCredentialSubjectAction,
    dispatch?: SignalDispatch,
  ) => void;
  setJwtOperation: (
    state: RenownCredentialState,
    action: SetJwtAction,
    dispatch?: SignalDispatch,
  ) => void;
  setCredentialStatusOperation: (
    state: RenownCredentialState,
    action: SetCredentialStatusAction,
    dispatch?: SignalDispatch,
  ) => void;
}
