import type { EditorModule } from "document-model";
import { Editor } from "./editor.js";

export const module: EditorModule = {
  Component: Editor,
  documentTypes: ["powerhouse/renown-user"],
  config: {
    id: "renown-user-editor",
    name: "Renown User Editor",
  },
};
