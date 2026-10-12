/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { createAction } from "document-model";
import {
  AddDomainInputSchema,
  RemoveDomainInputSchema,
  SetDomainStatusInputSchema,
} from "../schema/zod.js";
import type {
  AddDomainInput,
  RemoveDomainInput,
  SetDomainStatusInput,
} from "../types.js";
import type {
  AddDomainAction,
  RemoveDomainAction,
  SetDomainStatusAction,
} from "./actions.js";

export const addDomain = (input: AddDomainInput) =>
  createAction<AddDomainAction>(
    "ADD_DOMAIN",
    { ...input },
    undefined,
    AddDomainInputSchema,
    "global",
  );

export const setDomainStatus = (input: SetDomainStatusInput) =>
  createAction<SetDomainStatusAction>(
    "SET_DOMAIN_STATUS",
    { ...input },
    undefined,
    SetDomainStatusInputSchema,
    "global",
  );

export const removeDomain = (input: RemoveDomainInput) =>
  createAction<RemoveDomainAction>(
    "REMOVE_DOMAIN",
    { ...input },
    undefined,
    RemoveDomainInputSchema,
    "global",
  );
