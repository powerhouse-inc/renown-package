/**
 * This is a scaffold file meant for customization:
 * - change it by adding new tests or modifying the existing ones
 */

import { describe, it, expect, beforeEach } from "vitest";
import { generateMock } from "@powerhousedao/codegen";
import utils from "../../gen/utils.js";
import { z, type AddAuthorizationInput } from "../../gen/schema/index.js";
import { reducer } from "../../gen/reducer.js";
import * as creators from "../../gen/authorization/creators.js";
import type { RenownUserDocument } from "../../gen/types.js";

describe("Authorization Operations", () => {
  let document: RenownUserDocument;

  beforeEach(() => {
    document = utils.createDocument();
  });

  it("should handle addAuthorization operation", () => {
    const input: AddAuthorizationInput = generateMock(
      z.AddAuthorizationInputSchema(),
    );

    const updatedDocument = reducer(document, creators.addAuthorization(input));

    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "ADD_AUTHORIZATION",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
