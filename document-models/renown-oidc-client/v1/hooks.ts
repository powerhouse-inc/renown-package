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
  RenownOidcClientAction,
  RenownOidcClientDocument,
} from "document-models/renown-oidc-client/v1";
import {
  assertIsRenownOidcClientDocument,
  isRenownOidcClientDocument,
} from "./gen/document-schema.js";

/** Hook to get a RenownOidcClient document by its id */
export function useRenownOidcClientDocumentById(
  documentId: string | null | undefined,
):
  | [RenownOidcClientDocument, DocumentDispatch<RenownOidcClientAction>]
  | [undefined, undefined] {
  const [document, dispatch] = useDocumentById(documentId);
  if (!isRenownOidcClientDocument(document)) return [undefined, undefined];
  return [document, dispatch];
}

/** Hook to get the selected RenownOidcClient document */
export function useSelectedRenownOidcClientDocument(): [
  RenownOidcClientDocument,
  DocumentDispatch<RenownOidcClientAction>,
] {
  const [document, dispatch] = useSelectedDocument();

  assertIsRenownOidcClientDocument(document);
  return [document, dispatch] as const;
}

/** Hook to get all RenownOidcClient documents in the selected drive */
export function useRenownOidcClientDocumentsInSelectedDrive() {
  const documentsInSelectedDrive = useDocumentsInSelectedDrive();
  return documentsInSelectedDrive?.filter(isRenownOidcClientDocument);
}

/** Hook to get all RenownOidcClient documents in the selected folder */
export function useRenownOidcClientDocumentsInSelectedFolder() {
  const documentsInSelectedFolder = useDocumentsInSelectedFolder();
  return documentsInSelectedFolder?.filter(isRenownOidcClientDocument);
}
