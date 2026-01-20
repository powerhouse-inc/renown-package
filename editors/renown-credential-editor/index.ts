import type { EditorModule } from "document-model";
import { Editor } from "./editor.js";

export const module: EditorModule = {
  Component: Editor,
  documentTypes: ["powerhouse/renown-credential"],
  config: {
    id: "renown-credential-editor",
    name: "Renown Credential Editor",
  },
};
