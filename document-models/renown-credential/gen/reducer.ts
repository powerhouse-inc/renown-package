// TODO: remove eslint-disable rules once refactor is done
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import type { StateReducer } from "document-model";
import { isDocumentAction, createReducer } from "document-model/core";
import type { RenownCredentialPHState } from "@powerhousedao/renown-package/document-models/renown-credential";

import { renownCredentialManagerOperations } from "../src/reducers/manager.js";

import {
  InitInputSchema,
  RevokeInputSchema,
  UpdateCredentialSubjectInputSchema,
  SetJwtInputSchema,
  SetCredentialStatusInputSchema,
} from "./schema/zod.js";

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

    case "UPDATE_CREDENTIAL_SUBJECT": {
      UpdateCredentialSubjectInputSchema().parse(action.input);

      renownCredentialManagerOperations.updateCredentialSubjectOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_JWT": {
      SetJwtInputSchema().parse(action.input);

      renownCredentialManagerOperations.setJwtOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_CREDENTIAL_STATUS": {
      SetCredentialStatusInputSchema().parse(action.input);

      renownCredentialManagerOperations.setCredentialStatusOperation(
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

export const reducer = createReducer<RenownCredentialPHState>(stateReducer);
