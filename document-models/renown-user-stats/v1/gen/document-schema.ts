/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import {
  BaseDocumentHeaderSchema,
  BaseDocumentStateSchema,
} from "document-model";
import { z } from "zod";
import { renownUserStatsDocumentType } from "./document-type.js";
import { RenownUserStatsStateSchema } from "./schema/zod.js";
import type {
  RenownUserStatsDocument,
  RenownUserStatsPHState,
} from "./types.js";

/** Schema for validating the header object of a RenownUserStats document */
export const RenownUserStatsDocumentHeaderSchema =
  BaseDocumentHeaderSchema.extend({
    documentType: z.literal(renownUserStatsDocumentType),
  });

/** Schema for validating the state object of a RenownUserStats document */
export const RenownUserStatsPHStateSchema = BaseDocumentStateSchema.extend({
  global: RenownUserStatsStateSchema(),
});

export const RenownUserStatsDocumentSchema = z.object({
  header: RenownUserStatsDocumentHeaderSchema,
  state: RenownUserStatsPHStateSchema,
  initialState: RenownUserStatsPHStateSchema,
});

/** Simple helper function to check if a state object is a RenownUserStats document state object */
export function isRenownUserStatsState(
  state: unknown,
): state is RenownUserStatsPHState {
  return RenownUserStatsPHStateSchema.safeParse(state).success;
}

/** Simple helper function to assert that a document state object is a RenownUserStats document state object */
export function assertIsRenownUserStatsState(
  state: unknown,
): asserts state is RenownUserStatsPHState {
  RenownUserStatsPHStateSchema.parse(state);
}

/** Simple helper function to check if a document is a RenownUserStats document */
export function isRenownUserStatsDocument(
  document: unknown,
): document is RenownUserStatsDocument {
  return RenownUserStatsDocumentSchema.safeParse(document).success;
}

/** Simple helper function to assert that a document is a RenownUserStats document */
export function assertIsRenownUserStatsDocument(
  document: unknown,
): asserts document is RenownUserStatsDocument {
  RenownUserStatsDocumentSchema.parse(document);
}
