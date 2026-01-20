import {
  BaseDocumentHeaderSchema,
  BaseDocumentStateSchema,
} from "document-model";
import { z } from "zod";
import { renownUserDocumentType } from "./document-type.js";
import { RenownUserStateSchema } from "./schema/zod.js";
import type { RenownUserDocument, RenownUserPHState } from "./types.js";

/** Schema for validating the header object of a RenownUser document */
export const RenownUserDocumentHeaderSchema = BaseDocumentHeaderSchema.extend({
  documentType: z.literal(renownUserDocumentType),
});

/** Schema for validating the state object of a RenownUser document */
export const RenownUserPHStateSchema = BaseDocumentStateSchema.extend({
  global: RenownUserStateSchema(),
});

export const RenownUserDocumentSchema = z.object({
  header: RenownUserDocumentHeaderSchema,
  state: RenownUserPHStateSchema,
  initialState: RenownUserPHStateSchema,
});

/** Simple helper function to check if a state object is a RenownUser document state object */
export function isRenownUserState(state: unknown): state is RenownUserPHState {
  return RenownUserPHStateSchema.safeParse(state).success;
}

/** Simple helper function to assert that a document state object is a RenownUser document state object */
export function assertIsRenownUserState(
  state: unknown,
): asserts state is RenownUserPHState {
  RenownUserPHStateSchema.parse(state);
}

/** Simple helper function to check if a document is a RenownUser document */
export function isRenownUserDocument(
  document: unknown,
): document is RenownUserDocument {
  return RenownUserDocumentSchema.safeParse(document).success;
}

/** Simple helper function to assert that a document is a RenownUser document */
export function assertIsRenownUserDocument(
  document: unknown,
): asserts document is RenownUserDocument {
  RenownUserDocumentSchema.parse(document);
}
