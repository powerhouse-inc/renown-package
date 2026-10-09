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
  RenownAppProfileAction,
  RenownAppProfileDocument,
} from "document-models/renown-app-profile/v1";
import {
  assertIsRenownAppProfileDocument,
  isRenownAppProfileDocument,
} from "./gen/document-schema.js";

/** Hook to get a RenownAppProfile document by its id */
export function useRenownAppProfileDocumentById(
  documentId: string | null | undefined,
):
  | [RenownAppProfileDocument, DocumentDispatch<RenownAppProfileAction>]
  | [undefined, undefined] {
  const [document, dispatch] = useDocumentById(documentId);
  if (!isRenownAppProfileDocument(document)) return [undefined, undefined];
  return [document, dispatch];
}

/** Hook to get the selected RenownAppProfile document */
export function useSelectedRenownAppProfileDocument(): [
  RenownAppProfileDocument,
  DocumentDispatch<RenownAppProfileAction>,
] {
  const [document, dispatch] = useSelectedDocument();

  assertIsRenownAppProfileDocument(document);
  return [document, dispatch] as const;
}

/** Hook to get all RenownAppProfile documents in the selected drive */
export function useRenownAppProfileDocumentsInSelectedDrive() {
  const documentsInSelectedDrive = useDocumentsInSelectedDrive();
  return documentsInSelectedDrive?.filter(isRenownAppProfileDocument);
}

/** Hook to get all RenownAppProfile documents in the selected folder */
export function useRenownAppProfileDocumentsInSelectedFolder() {
  const documentsInSelectedFolder = useDocumentsInSelectedFolder();
  return documentsInSelectedFolder?.filter(isRenownAppProfileDocument);
}
