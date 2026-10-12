/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { DocumentDispatch } from "@powerhousedao/reactor-browser";
import {
  useDocumentById,
  useDocumentsInSelectedDrive,
  useDocumentsInSelectedFolder,
  useSelectedDocument,
} from "@powerhousedao/reactor-browser";
import type {
  RenownOrganizationAction,
  RenownOrganizationDocument,
} from "document-models/renown-organization/v1";
import {
  assertIsRenownOrganizationDocument,
  isRenownOrganizationDocument,
} from "./gen/document-schema.js";

/** Hook to get a RenownOrganization document by its id */
export function useRenownOrganizationDocumentById(
  documentId: string | null | undefined,
):
  | [RenownOrganizationDocument, DocumentDispatch<RenownOrganizationAction>]
  | [undefined, undefined] {
  const [document, dispatch] = useDocumentById(documentId);
  if (!isRenownOrganizationDocument(document)) return [undefined, undefined];
  return [document, dispatch];
}

/** Hook to get the selected RenownOrganization document */
export function useSelectedRenownOrganizationDocument(): [
  RenownOrganizationDocument,
  DocumentDispatch<RenownOrganizationAction>,
] {
  const [document, dispatch] = useSelectedDocument();

  assertIsRenownOrganizationDocument(document);
  return [document, dispatch] as const;
}

/** Hook to get all RenownOrganization documents in the selected drive */
export function useRenownOrganizationDocumentsInSelectedDrive() {
  const documentsInSelectedDrive = useDocumentsInSelectedDrive();
  return documentsInSelectedDrive?.filter(isRenownOrganizationDocument);
}

/** Hook to get all RenownOrganization documents in the selected folder */
export function useRenownOrganizationDocumentsInSelectedFolder() {
  const documentsInSelectedFolder = useDocumentsInSelectedFolder();
  return documentsInSelectedFolder?.filter(isRenownOrganizationDocument);
}
