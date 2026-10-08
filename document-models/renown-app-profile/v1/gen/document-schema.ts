/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import {
  BaseDocumentHeaderSchema,
  BaseDocumentStateSchema,
} from "document-model";
import { z } from "zod";
import { renownAppProfileDocumentType } from "./document-type.js";
import { RenownAppProfileStateSchema } from "./schema/zod.js";
import type {
  RenownAppProfileDocument,
  RenownAppProfilePHState,
} from "./types.js";

/** Schema for validating the header object of a RenownAppProfile document */
export const RenownAppProfileDocumentHeaderSchema =
  BaseDocumentHeaderSchema.extend({
    documentType: z.literal(renownAppProfileDocumentType),
  });

/** Schema for validating the state object of a RenownAppProfile document */
export const RenownAppProfilePHStateSchema = BaseDocumentStateSchema.extend({
  global: RenownAppProfileStateSchema(),
});

export const RenownAppProfileDocumentSchema = z.object({
  header: RenownAppProfileDocumentHeaderSchema,
  state: RenownAppProfilePHStateSchema,
  initialState: RenownAppProfilePHStateSchema,
});

/** Simple helper function to check if a state object is a RenownAppProfile document state object */
export function isRenownAppProfileState(
  state: unknown,
): state is RenownAppProfilePHState {
  return RenownAppProfilePHStateSchema.safeParse(state).success;
}

/** Simple helper function to assert that a document state object is a RenownAppProfile document state object */
export function assertIsRenownAppProfileState(
  state: unknown,
): asserts state is RenownAppProfilePHState {
  RenownAppProfilePHStateSchema.parse(state);
}

/** Simple helper function to check if a document is a RenownAppProfile document */
export function isRenownAppProfileDocument(
  document: unknown,
): document is RenownAppProfileDocument {
  return RenownAppProfileDocumentSchema.safeParse(document).success;
}

/** Simple helper function to assert that a document is a RenownAppProfile document */
export function assertIsRenownAppProfileDocument(
  document: unknown,
): asserts document is RenownAppProfileDocument {
  RenownAppProfileDocumentSchema.parse(document);
}
