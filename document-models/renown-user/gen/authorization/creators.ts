import { createAction } from "document-model";
import {
  z,
  type AddAuthorizationInput,
  type RevokeAuthorizationInput,
  type RemoveAuthorizationInput,
} from "../types.js";
import {
  type AddAuthorizationAction,
  type RevokeAuthorizationAction,
  type RemoveAuthorizationAction,
} from "./actions.js";

export const addAuthorization = (input: AddAuthorizationInput) =>
  createAction<AddAuthorizationAction>(
    "ADD_AUTHORIZATION",
    { ...input },
    undefined,
    z.AddAuthorizationInputSchema,
    "global",
  );

export const revokeAuthorization = (input: RevokeAuthorizationInput) =>
  createAction<RevokeAuthorizationAction>(
    "REVOKE_AUTHORIZATION",
    { ...input },
    undefined,
    z.RevokeAuthorizationInputSchema,
    "global",
  );

export const removeAuthorization = (input: RemoveAuthorizationInput) =>
  createAction<RemoveAuthorizationAction>(
    "REMOVE_AUTHORIZATION",
    { ...input },
    undefined,
    z.RemoveAuthorizationInputSchema,
    "global",
  );
