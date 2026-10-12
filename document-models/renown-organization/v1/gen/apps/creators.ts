/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { createAction } from "document-model";
import {
  AddOrgAppInputSchema,
  RemoveOrgAppInputSchema,
  SetAppFrozenInputSchema,
} from "../schema/zod.js";
import type {
  AddOrgAppInput,
  RemoveOrgAppInput,
  SetAppFrozenInput,
} from "../types.js";
import type {
  AddOrgAppAction,
  RemoveOrgAppAction,
  SetAppFrozenAction,
} from "./actions.js";

export const addOrgApp = (input: AddOrgAppInput) =>
  createAction<AddOrgAppAction>(
    "ADD_ORG_APP",
    { ...input },
    undefined,
    AddOrgAppInputSchema,
    "global",
  );

export const removeOrgApp = (input: RemoveOrgAppInput) =>
  createAction<RemoveOrgAppAction>(
    "REMOVE_ORG_APP",
    { ...input },
    undefined,
    RemoveOrgAppInputSchema,
    "global",
  );

export const setAppFrozen = (input: SetAppFrozenInput) =>
  createAction<SetAppFrozenAction>(
    "SET_APP_FROZEN",
    { ...input },
    undefined,
    SetAppFrozenInputSchema,
    "global",
  );
