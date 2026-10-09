/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { createAction } from "document-model";
import {
  AddMetricInputSchema,
  RemoveMetricInputSchema,
  ReorderMetricsInputSchema,
  UpdateMetricInputSchema,
} from "../schema/zod.js";
import type {
  AddMetricInput,
  RemoveMetricInput,
  ReorderMetricsInput,
  UpdateMetricInput,
} from "../types.js";
import type {
  AddMetricAction,
  RemoveMetricAction,
  ReorderMetricsAction,
  UpdateMetricAction,
} from "./actions.js";

export const addMetric = (input: AddMetricInput) =>
  createAction<AddMetricAction>(
    "ADD_METRIC",
    { ...input },
    undefined,
    AddMetricInputSchema,
    "global",
  );

export const updateMetric = (input: UpdateMetricInput) =>
  createAction<UpdateMetricAction>(
    "UPDATE_METRIC",
    { ...input },
    undefined,
    UpdateMetricInputSchema,
    "global",
  );

export const removeMetric = (input: RemoveMetricInput) =>
  createAction<RemoveMetricAction>(
    "REMOVE_METRIC",
    { ...input },
    undefined,
    RemoveMetricInputSchema,
    "global",
  );

export const reorderMetrics = (input: ReorderMetricsInput) =>
  createAction<ReorderMetricsAction>(
    "REORDER_METRICS",
    { ...input },
    undefined,
    ReorderMetricsInputSchema,
    "global",
  );
