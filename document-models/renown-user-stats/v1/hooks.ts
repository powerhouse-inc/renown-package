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
  RenownUserStatsAction,
  RenownUserStatsDocument,
} from "document-models/renown-user-stats/v1";
import {
  assertIsRenownUserStatsDocument,
  isRenownUserStatsDocument,
} from "./gen/document-schema.js";

/** Hook to get a RenownUserStats document by its id */
export function useRenownUserStatsDocumentById(
  documentId: string | null | undefined,
):
  | [RenownUserStatsDocument, DocumentDispatch<RenownUserStatsAction>]
  | [undefined, undefined] {
  const [document, dispatch] = useDocumentById(documentId);
  if (!isRenownUserStatsDocument(document)) return [undefined, undefined];
  return [document, dispatch];
}

/** Hook to get the selected RenownUserStats document */
export function useSelectedRenownUserStatsDocument(): [
  RenownUserStatsDocument,
  DocumentDispatch<RenownUserStatsAction>,
] {
  const [document, dispatch] = useSelectedDocument();

  assertIsRenownUserStatsDocument(document);
  return [document, dispatch] as const;
}

/** Hook to get all RenownUserStats documents in the selected drive */
export function useRenownUserStatsDocumentsInSelectedDrive() {
  const documentsInSelectedDrive = useDocumentsInSelectedDrive();
  return documentsInSelectedDrive?.filter(isRenownUserStatsDocument);
}

/** Hook to get all RenownUserStats documents in the selected folder */
export function useRenownUserStatsDocumentsInSelectedFolder() {
  const documentsInSelectedFolder = useDocumentsInSelectedFolder();
  return documentsInSelectedFolder?.filter(isRenownUserStatsDocument);
}
