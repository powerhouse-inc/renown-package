/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import {
  BaseDocumentHeaderSchema,
  BaseDocumentStateSchema,
} from "document-model";
import { z } from "zod";
import { renownOidcClientDocumentType } from "./document-type.js";
import { RenownOidcClientStateSchema } from "./schema/zod.js";
import type {
  RenownOidcClientDocument,
  RenownOidcClientPHState,
} from "./types.js";

/** Schema for validating the header object of a RenownOidcClient document */
export const RenownOidcClientDocumentHeaderSchema =
  BaseDocumentHeaderSchema.extend({
    documentType: z.literal(renownOidcClientDocumentType),
  });

/** Schema for validating the state object of a RenownOidcClient document */
export const RenownOidcClientPHStateSchema = BaseDocumentStateSchema.extend({
  global: RenownOidcClientStateSchema(),
});

export const RenownOidcClientDocumentSchema = z.object({
  header: RenownOidcClientDocumentHeaderSchema,
  state: RenownOidcClientPHStateSchema,
  initialState: RenownOidcClientPHStateSchema,
});

/** Simple helper function to check if a state object is a RenownOidcClient document state object */
export function isRenownOidcClientState(
  state: unknown,
): state is RenownOidcClientPHState {
  return RenownOidcClientPHStateSchema.safeParse(state).success;
}

/** Simple helper function to assert that a document state object is a RenownOidcClient document state object */
export function assertIsRenownOidcClientState(
  state: unknown,
): asserts state is RenownOidcClientPHState {
  RenownOidcClientPHStateSchema.parse(state);
}

/** Simple helper function to check if a document is a RenownOidcClient document */
export function isRenownOidcClientDocument(
  document: unknown,
): document is RenownOidcClientDocument {
  return RenownOidcClientDocumentSchema.safeParse(document).success;
}

/** Simple helper function to assert that a document is a RenownOidcClient document */
export function assertIsRenownOidcClientDocument(
  document: unknown,
): asserts document is RenownOidcClientDocument {
  RenownOidcClientDocumentSchema.parse(document);
}
