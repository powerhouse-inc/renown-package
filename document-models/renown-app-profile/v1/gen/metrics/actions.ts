/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { Action } from "document-model";
import type {
  AddMetricInput,
  RemoveMetricInput,
  ReorderMetricsInput,
  UpdateMetricInput,
} from "../types.js";

export type AddMetricAction = Action & {
  type: "ADD_METRIC";
  input: AddMetricInput;
};
export type UpdateMetricAction = Action & {
  type: "UPDATE_METRIC";
  input: UpdateMetricInput;
};
export type RemoveMetricAction = Action & {
  type: "REMOVE_METRIC";
  input: RemoveMetricInput;
};
export type ReorderMetricsAction = Action & {
  type: "REORDER_METRICS";
  input: ReorderMetricsInput;
};

export type RenownAppProfileMetricsAction =
  | AddMetricAction
  | UpdateMetricAction
  | RemoveMetricAction
  | ReorderMetricsAction;
