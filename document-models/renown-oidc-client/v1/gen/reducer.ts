/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import type { Reducer, StateReducer } from "document-model";
import { createReducer, isDocumentAction } from "document-model";
import type { RenownOidcClientPHState } from "document-models/renown-oidc-client/v1";

import { renownOidcClientClientOperations } from "../src/reducers/client.js";

import {
  AddAllowedSubjectInputSchema,
  AddRedirectUriInputSchema,
  RemoveAllowedSubjectInputSchema,
  RemoveRedirectUriInputSchema,
  SetAllowAnySubjectInputSchema,
  SetClientInfoInputSchema,
  SetClientSecretHashInputSchema,
  SetStatusInputSchema,
} from "./schema/zod.js";

const schemaMemo = new Map<() => unknown, unknown>();

function memoizedSchema<T>(makeSchema: () => T): T {
  let schema = schemaMemo.get(makeSchema) as T | undefined;
  if (schema === undefined) {
    schema = makeSchema();
    schemaMemo.set(makeSchema, schema);
  }
  return schema;
}

const stateReducer: StateReducer<RenownOidcClientPHState> = (
  state,
  action,
  dispatch,
) => {
  if (isDocumentAction(action)) {
    return state;
  }
  switch (action.type) {
    case "SET_CLIENT_INFO": {
      memoizedSchema(SetClientInfoInputSchema).parse(action.input);

      renownOidcClientClientOperations.setClientInfoOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ADD_REDIRECT_URI": {
      memoizedSchema(AddRedirectUriInputSchema).parse(action.input);

      renownOidcClientClientOperations.addRedirectUriOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "REMOVE_REDIRECT_URI": {
      memoizedSchema(RemoveRedirectUriInputSchema).parse(action.input);

      renownOidcClientClientOperations.removeRedirectUriOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ADD_ALLOWED_SUBJECT": {
      memoizedSchema(AddAllowedSubjectInputSchema).parse(action.input);

      renownOidcClientClientOperations.addAllowedSubjectOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "REMOVE_ALLOWED_SUBJECT": {
      memoizedSchema(RemoveAllowedSubjectInputSchema).parse(action.input);

      renownOidcClientClientOperations.removeAllowedSubjectOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_ALLOW_ANY_SUBJECT": {
      memoizedSchema(SetAllowAnySubjectInputSchema).parse(action.input);

      renownOidcClientClientOperations.setAllowAnySubjectOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_CLIENT_SECRET_HASH": {
      memoizedSchema(SetClientSecretHashInputSchema).parse(action.input);

      renownOidcClientClientOperations.setClientSecretHashOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_STATUS": {
      memoizedSchema(SetStatusInputSchema).parse(action.input);

      renownOidcClientClientOperations.setStatusOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    default:
      return state;
  }
};

export const reducer: Reducer<RenownOidcClientPHState> =
  createReducer(stateReducer);
