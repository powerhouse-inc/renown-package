import { describe, expect, it } from "vitest";
import { Kind } from "graphql";
import { schema } from "../schema.js";

describe("renown-user schema", () => {
  it("has no Mutation type: the subgraph is read-only", () => {
    const mutationType = schema.definitions.find(
      (def) =>
        def.kind === Kind.OBJECT_TYPE_DEFINITION && def.name.value === "Mutation",
    );

    expect(mutationType).toBeUndefined();
  });

  it("still defines the Query type", () => {
    const queryType = schema.definitions.find(
      (def) =>
        def.kind === Kind.OBJECT_TYPE_DEFINITION && def.name.value === "Query",
    );

    expect(queryType).toBeDefined();
  });
});
