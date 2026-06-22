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
      SetUsernameInputSchema().parse(action.input);

      renownUserProfileOperations.setUsernameOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_ETH_ADDRESS": {
      SetEthAddressInputSchema().parse(action.input);

      renownUserProfileOperations.setEthAddressOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_USER_IMAGE": {
      SetUserImageInputSchema().parse(action.input);

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
