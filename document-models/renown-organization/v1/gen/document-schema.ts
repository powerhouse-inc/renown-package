/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import {
  BaseDocumentHeaderSchema,
  BaseDocumentStateSchema,
} from "document-model";
import { z } from "zod";
import { renownOrganizationDocumentType } from "./document-type.js";
import { RenownOrganizationStateSchema } from "./schema/zod.js";
import type {
  RenownOrganizationDocument,
  RenownOrganizationPHState,
} from "./types.js";

/** Schema for validating the header object of a RenownOrganization document */
export const RenownOrganizationDocumentHeaderSchema =
  BaseDocumentHeaderSchema.extend({
    documentType: z.literal(renownOrganizationDocumentType),
  });

/** Schema for validating the state object of a RenownOrganization document */
export const RenownOrganizationPHStateSchema = BaseDocumentStateSchema.extend({
  global: RenownOrganizationStateSchema(),
});

export const RenownOrganizationDocumentSchema = z.object({
  header: RenownOrganizationDocumentHeaderSchema,
  state: RenownOrganizationPHStateSchema,
  initialState: RenownOrganizationPHStateSchema,
});

/** Simple helper function to check if a state object is a RenownOrganization document state object */
export function isRenownOrganizationState(
  state: unknown,
): state is RenownOrganizationPHState {
  return RenownOrganizationPHStateSchema.safeParse(state).success;
}

/** Simple helper function to assert that a document state object is a RenownOrganization document state object */
export function assertIsRenownOrganizationState(
  state: unknown,
): asserts state is RenownOrganizationPHState {
  RenownOrganizationPHStateSchema.parse(state);
}

/** Simple helper function to check if a document is a RenownOrganization document */
export function isRenownOrganizationDocument(
  document: unknown,
): document is RenownOrganizationDocument {
  return RenownOrganizationDocumentSchema.safeParse(document).success;
}

/** Simple helper function to assert that a document is a RenownOrganization document */
export function assertIsRenownOrganizationDocument(
  document: unknown,
): asserts document is RenownOrganizationDocument {
  RenownOrganizationDocumentSchema.parse(document);
}
