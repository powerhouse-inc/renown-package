/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import type { Reducer, StateReducer } from "document-model";
import { createReducer, isDocumentAction } from "document-model";
import type { RenownUserStatsPHState } from "document-models/renown-user-stats/v1";

import { renownUserStatsStatsOperations } from "../src/reducers/stats.js";

import { SetStatInputSchema, SetUserDidInputSchema } from "./schema/zod.js";

const schemaMemo = new Map<() => unknown, unknown>();

function memoizedSchema<T>(makeSchema: () => T): T {
  let schema = schemaMemo.get(makeSchema) as T | undefined;
  if (schema === undefined) {
    schema = makeSchema();
    schemaMemo.set(makeSchema, schema);
  }
  return schema;
}

const stateReducer: StateReducer<RenownUserStatsPHState> = (
  state,
  action,
  dispatch,
) => {
  if (isDocumentAction(action)) {
    return state;
  }
  switch (action.type) {
    case "SET_USER_DID": {
      memoizedSchema(SetUserDidInputSchema).parse(action.input);

      renownUserStatsStatsOperations.setUserDidOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_STAT": {
      memoizedSchema(SetStatInputSchema).parse(action.input);

      renownUserStatsStatsOperations.setStatOperation(
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

export const reducer: Reducer<RenownUserStatsPHState> =
  createReducer(stateReducer);
