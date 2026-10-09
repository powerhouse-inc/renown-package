/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import type { Reducer, StateReducer } from "document-model";
import { createReducer, isDocumentAction } from "document-model";
import type { RenownAppProfilePHState } from "document-models/renown-app-profile/v1";

import { renownAppProfileMetricsOperations } from "../src/reducers/metrics.js";
import { renownAppProfileProfileOperations } from "../src/reducers/profile.js";

import {
  AddLinkInputSchema,
  AddMetricInputSchema,
  RemoveLinkInputSchema,
  RemoveMetricInputSchema,
  ReorderLinksInputSchema,
  ReorderMetricsInputSchema,
  SetAppDidInputSchema,
  SetProfileInputSchema,
  SetPublisherDidInputSchema,
  UpdateLinkInputSchema,
  UpdateMetricInputSchema,
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

const stateReducer: StateReducer<RenownAppProfilePHState> = (
  state,
  action,
  dispatch,
) => {
  if (isDocumentAction(action)) {
    return state;
  }
  switch (action.type) {
    case "SET_APP_DID": {
      memoizedSchema(SetAppDidInputSchema).parse(action.input);

      renownAppProfileProfileOperations.setAppDidOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_PUBLISHER_DID": {
      memoizedSchema(SetPublisherDidInputSchema).parse(action.input);

      renownAppProfileProfileOperations.setPublisherDidOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_PROFILE": {
      memoizedSchema(SetProfileInputSchema).parse(action.input);

      renownAppProfileProfileOperations.setProfileOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ADD_LINK": {
      memoizedSchema(AddLinkInputSchema).parse(action.input);

      renownAppProfileProfileOperations.addLinkOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "UPDATE_LINK": {
      memoizedSchema(UpdateLinkInputSchema).parse(action.input);

      renownAppProfileProfileOperations.updateLinkOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "REMOVE_LINK": {
      memoizedSchema(RemoveLinkInputSchema).parse(action.input);

      renownAppProfileProfileOperations.removeLinkOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "REORDER_LINKS": {
      memoizedSchema(ReorderLinksInputSchema).parse(action.input);

      renownAppProfileProfileOperations.reorderLinksOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ADD_METRIC": {
      memoizedSchema(AddMetricInputSchema).parse(action.input);

      renownAppProfileMetricsOperations.addMetricOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "UPDATE_METRIC": {
      memoizedSchema(UpdateMetricInputSchema).parse(action.input);

      renownAppProfileMetricsOperations.updateMetricOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "REMOVE_METRIC": {
      memoizedSchema(RemoveMetricInputSchema).parse(action.input);

      renownAppProfileMetricsOperations.removeMetricOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "REORDER_METRICS": {
      memoizedSchema(ReorderMetricsInputSchema).parse(action.input);

      renownAppProfileMetricsOperations.reorderMetricsOperation(
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

export const reducer: Reducer<RenownAppProfilePHState> =
  createReducer(stateReducer);
