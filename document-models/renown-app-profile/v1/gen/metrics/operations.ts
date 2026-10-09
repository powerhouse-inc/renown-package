/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { type SignalDispatch } from "document-model";
import type { RenownAppProfileGlobalState } from "../types.js";
import type {
  AddMetricAction,
  RemoveMetricAction,
  ReorderMetricsAction,
  UpdateMetricAction,
} from "./actions.js";

export interface RenownAppProfileMetricsOperations {
  addMetricOperation: (
    state: RenownAppProfileGlobalState,
    action: AddMetricAction,
    dispatch?: SignalDispatch,
  ) => void;
  updateMetricOperation: (
    state: RenownAppProfileGlobalState,
    action: UpdateMetricAction,
    dispatch?: SignalDispatch,
  ) => void;
  removeMetricOperation: (
    state: RenownAppProfileGlobalState,
    action: RemoveMetricAction,
    dispatch?: SignalDispatch,
  ) => void;
  reorderMetricsOperation: (
    state: RenownAppProfileGlobalState,
    action: ReorderMetricsAction,
    dispatch?: SignalDispatch,
  ) => void;
}
