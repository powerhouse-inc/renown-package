import { type Action } from "document-model";
import type {
  InitInput,
  RevokeInput,
  UpdateCredentialSubjectInput,
  SetJwtInput,
  SetCredentialStatusInput,
} from "../types.js";

export type InitAction = Action & { type: "INIT"; input: InitInput };
export type RevokeAction = Action & { type: "REVOKE"; input: RevokeInput };
export type UpdateCredentialSubjectAction = Action & {
  type: "UPDATE_CREDENTIAL_SUBJECT";
  input: UpdateCredentialSubjectInput;
};
export type SetJwtAction = Action & { type: "SET_JWT"; input: SetJwtInput };
export type SetCredentialStatusAction = Action & {
  type: "SET_CREDENTIAL_STATUS";
  input: SetCredentialStatusInput;
};

export type RenownCredentialManagerAction =
  | InitAction
  | RevokeAction
  | UpdateCredentialSubjectAction
  | SetJwtAction
  | SetCredentialStatusAction;
