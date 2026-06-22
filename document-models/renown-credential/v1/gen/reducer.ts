/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import type { Reducer, StateReducer } from "document-model";
import { createReducer, isDocumentAction } from "document-model";
import type { RenownCredentialPHState } from "document-models/renown-credential/v1";

import { renownCredentialManagerOperations } from "../src/reducers/manager.js";

import { InitInputSchema, RevokeInputSchema } from "./schema/zod.js";

const stateReducer: StateReducer<RenownCredentialPHState> = (
  state,
  action,
  dispatch,
) => {
  if (isDocumentAction(action)) {
    return state;
  }
  switch (action.type) {
    case "INIT": {
      InitInputSchema().parse(action.input);

      renownCredentialManagerOperations.initOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "REVOKE": {
      RevokeInputSchema().parse(action.input);

      renownCredentialManagerOperations.revokeOperation(
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

export const reducer: Reducer<RenownCredentialPHState> =
  createReducer(stateReducer);
