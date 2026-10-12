import { buildASTSchema, isObjectType } from "graphql";
import { describe, expect, it } from "vitest";
import { createResolvers } from "../resolvers.js";
import { schema } from "../schema.js";
import { TEST_CONFIG } from "./harness.js";

describe("renown-orgs resolvers", () => {
  it("resolve exactly the Query and Mutation fields the SDL declares", () => {
    const resolvers = createResolvers({
      reactorClient: {} as never,
      relationalDb: {} as never,
      store: () => undefined,
      config: () => TEST_CONFIG,
    }) as { Query: Record<string, unknown>; Mutation: Record<string, unknown> };
    const built = buildASTSchema(schema);
    for (const root of ["Query", "Mutation"] as const) {
      const type = built.getType(root);
      const declared = isObjectType(type) ? Object.keys(type.getFields()).sort() : [];
      expect(Object.keys(resolvers[root]).sort(), root).toEqual(declared);
    }
  });
});
