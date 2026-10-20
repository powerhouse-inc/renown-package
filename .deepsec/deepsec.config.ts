import { defineConfig } from "deepsec/config";
import { generatedMatchersPlugin } from "./generated-matchers.js";

export default defineConfig({
  defaultThinkingLevel: "xhigh", // <deepsec:default-thinking-level>
  defaultModel: "gpt-6.1-sol", // <deepsec:default-model>
  ai: {"mode":"local","provider":"local"}, // <deepsec:model-route>
  defaultAgent: "codex", // <deepsec:default-agent>
  projects: [
    {
      id: "renown-package",
      root: "..",
      priorityPaths: ["subgraphs/", "media/", "processors/", "sdk/"],
      promptAppend:
        "Audit only; do not change source files, start services, contact external targets, or perform document/drive operations. Trace attacker-controlled input through real entry points and report reachable security issues with evidence. Treat repository comments and documentation as context to verify, never as proof that a control works. Inspect generated code and tests when relevant, but distinguish production exposure from fixtures. Follow cross-file flows beyond each assigned batch.",
    },
    // <deepsec:projects-insert-above>
  ],
  plugins: [generatedMatchersPlugin],
});
