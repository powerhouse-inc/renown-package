import {
  useDocumentOfType,
  useSelectedDocumentId,
} from "@powerhousedao/reactor-browser";
import type {
  RenownUserAction,
  RenownUserDocument,
} from "../../document-models/renown-user/index.js";

export function useRenownUserDocument(documentId: string | null | undefined) {
  return useDocumentOfType<RenownUserDocument, RenownUserAction>(
    documentId,
    "powerhouse/renown-user",
  );
}

export function useSelectedRenownUserDocument() {
  const selectedDocumentId = useSelectedDocumentId();
  return useRenownUserDocument(selectedDocumentId);
}
