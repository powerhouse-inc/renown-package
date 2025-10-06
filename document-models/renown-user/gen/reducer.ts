// TODO: remove eslint-disable rules once refactor is done
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {
  type StateReducer,
  isDocumentAction,
  createReducer,
} from "document-model";
import { RenownUserPHState } from "./ph-factories.js";
import { z } from "./types.js";

import { reducer as ProfileReducer } from "../src/reducers/profile.js";

export const stateReducer: StateReducer<RenownUserPHState> = (
  state,
  action,
  dispatch,
) => {
  if (isDocumentAction(action)) {
    return state;
  }

  switch (action.type) {
    case "SET_USERNAME":
      z.SetUsernameInputSchema().parse(action.input);
      ProfileReducer.setUsernameOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );
      break;

    case "SET_ETH_ADDRESS":
      z.SetEthAddressInputSchema().parse(action.input);
      ProfileReducer.setEthAddressOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );
      break;

    case "SET_USER_IMAGE":
      z.SetUserImageInputSchema().parse(action.input);
      ProfileReducer.setUserImageOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );
      break;

    default:
      return state;
  }
};

export const reducer = createReducer<RenownUserPHState>(stateReducer);
