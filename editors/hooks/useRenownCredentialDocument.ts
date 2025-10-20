import {
  useDocumentOfType,
  useSelectedDocumentId,
} from "@powerhousedao/reactor-browser";
import type {
  RenownCredentialAction,
  RenownCredentialDocument,
} from "../../document-models/renown-credential/index.js";

export function useRenownCredentialDocument(documentId: string | null | undefined) {
  return useDocumentOfType<RenownCredentialDocument, RenownCredentialAction>(
    documentId,
    "powerhouse/renown-credential",
  );
}

export function useSelectedRenownCredentialDocument() {
  const selectedDocumentId = useSelectedDocumentId();
  return useRenownCredentialDocument(selectedDocumentId);
}
