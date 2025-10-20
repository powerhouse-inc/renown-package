// TODO: remove eslint-disable rules once refactor is done
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import {
  type StateReducer,
  isDocumentAction,
  createReducer,
} from "document-model";
import { RenownCredentialPHState } from "./ph-factories.js";
import { z } from "./types.js";

import { reducer as ManagerReducer } from "../src/reducers/manager.js";

export const stateReducer: StateReducer<RenownCredentialPHState> = (
  state,
  action,
  dispatch,
) => {
  if (isDocumentAction(action)) {
    return state;
  }

  switch (action.type) {
    case "INIT":
      z.InitInputSchema().parse(action.input);
      ManagerReducer.initOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );
      break;

    case "REVOKE":
      z.RevokeInputSchema().parse(action.input);
      ManagerReducer.revokeOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );
      break;

    case "UPDATE_CREDENTIAL_SUBJECT":
      z.UpdateCredentialSubjectInputSchema().parse(action.input);
      ManagerReducer.updateCredentialSubjectOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );
      break;

    case "SET_JWT":
      z.SetJwtInputSchema().parse(action.input);
      ManagerReducer.setJwtOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );
      break;

    case "SET_CREDENTIAL_STATUS":
      z.SetCredentialStatusInputSchema().parse(action.input);
      ManagerReducer.setCredentialStatusOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );
      break;

    default:
      return state;
  }
};

export const reducer = createReducer<RenownCredentialPHState>(stateReducer);
