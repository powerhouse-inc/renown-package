/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import type { Reducer, StateReducer } from "document-model";
import { createReducer, isDocumentAction } from "document-model";
import type { RenownUserPHState } from "document-models/renown-user/v1";

import { renownUserProfileOperations } from "../src/reducers/profile.js";

import {
  SetEthAddressInputSchema,
  SetUserImageInputSchema,
  SetUsernameInputSchema,
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

const stateReducer: StateReducer<RenownUserPHState> = (
  state,
  action,
  dispatch,
) => {
  if (isDocumentAction(action)) {
    return state;
  }
  switch (action.type) {
    case "SET_USERNAME": {
      memoizedSchema(SetUsernameInputSchema).parse(action.input);

      renownUserProfileOperations.setUsernameOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_ETH_ADDRESS": {
      memoizedSchema(SetEthAddressInputSchema).parse(action.input);

      renownUserProfileOperations.setEthAddressOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_USER_IMAGE": {
      memoizedSchema(SetUserImageInputSchema).parse(action.input);

      renownUserProfileOperations.setUserImageOperation(
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

export const reducer: Reducer<RenownUserPHState> = createReducer(stateReducer);
