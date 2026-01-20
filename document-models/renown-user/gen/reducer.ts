// TODO: remove eslint-disable rules once refactor is done
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import type { StateReducer } from "document-model";
import { isDocumentAction, createReducer } from "document-model/core";
import type { RenownUserPHState } from "@powerhousedao/renown-package/document-models/renown-user";

import { renownUserProfileOperations } from "../src/reducers/profile.js";

import {
  SetUsernameInputSchema,
  SetEthAddressInputSchema,
  SetUserImageInputSchema,
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

export const reducer = createReducer<RenownUserPHState>(stateReducer);
