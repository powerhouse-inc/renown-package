import { describe, expect, it } from "vitest";
import * as subgraphs from "./index.js";

// The switchboard instantiates every export of every subgraph module with
// `new`; a non-class export (a constant, a helper) crashes the host at boot.
describe("subgraph modules", () => {
  for (const [name, mod] of Object.entries(subgraphs)) {
    it(`${name} exports only subgraph classes`, () => {
      for (const [key, value] of Object.entries(mod as Record<string, unknown>)) {
        expect(typeof value, `${name}.${key}`).toBe("function");
        expect((value as { prototype?: unknown }).prototype, `${name}.${key}`).toBeDefined();
      }
    });
  }
});
