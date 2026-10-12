/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { Action } from "document-model";
import type {
  AddDomainInput,
  RemoveDomainInput,
  SetDomainStatusInput,
} from "../types.js";

export type AddDomainAction = Action & {
  type: "ADD_DOMAIN";
  input: AddDomainInput;
};
export type SetDomainStatusAction = Action & {
  type: "SET_DOMAIN_STATUS";
  input: SetDomainStatusInput;
};
export type RemoveDomainAction = Action & {
  type: "REMOVE_DOMAIN";
  input: RemoveDomainInput;
};

export type RenownOrganizationDomainsAction =
  | AddDomainAction
  | SetDomainStatusAction
  | RemoveDomainAction;
