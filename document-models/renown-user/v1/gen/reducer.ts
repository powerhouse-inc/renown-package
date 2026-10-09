/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import type { Reducer, StateReducer } from "document-model";
import { createReducer, isDocumentAction } from "document-model";
import type { RenownUserPHState } from "document-models/renown-user/v1";

import { renownUserProfileOperations } from "../src/reducers/profile.js";

import {
  AddLinkInputSchema,
  RemoveLinkInputSchema,
  ReorderLinksInputSchema,
  SetAvatarInputSchema,
  SetBioInputSchema,
  SetDisplayNameInputSchema,
  SetEthAddressInputSchema,
  SetHandleInputSchema,
  SetUserImageInputSchema,
  SetUsernameInputSchema,
  UpdateLinkInputSchema,
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

    case "SET_DISPLAY_NAME": {
      memoizedSchema(SetDisplayNameInputSchema).parse(action.input);

      renownUserProfileOperations.setDisplayNameOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_HANDLE": {
      memoizedSchema(SetHandleInputSchema).parse(action.input);

      renownUserProfileOperations.setHandleOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_BIO": {
      memoizedSchema(SetBioInputSchema).parse(action.input);

      renownUserProfileOperations.setBioOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_AVATAR": {
      memoizedSchema(SetAvatarInputSchema).parse(action.input);

      renownUserProfileOperations.setAvatarOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ADD_LINK": {
      memoizedSchema(AddLinkInputSchema).parse(action.input);

      renownUserProfileOperations.addLinkOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "UPDATE_LINK": {
      memoizedSchema(UpdateLinkInputSchema).parse(action.input);

      renownUserProfileOperations.updateLinkOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "REMOVE_LINK": {
      memoizedSchema(RemoveLinkInputSchema).parse(action.input);

      renownUserProfileOperations.removeLinkOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "REORDER_LINKS": {
      memoizedSchema(ReorderLinksInputSchema).parse(action.input);

      renownUserProfileOperations.reorderLinksOperation(
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
