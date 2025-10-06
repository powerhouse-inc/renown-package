/**
 * This is a scaffold file meant for customization:
 * - change it by adding new tests or modifying the existing ones
 */

import { describe, it, expect, beforeEach } from "vitest";
import { generateMock } from "@powerhousedao/codegen";
import utils from "../../gen/utils.js";
import { z, type SetUsernameInput } from "../../gen/schema/index.js";
import { reducer } from "../../gen/reducer.js";
import * as creators from "../../gen/profile/creators.js";
import type { RenownUserDocument } from "../../gen/types.js";

describe("Profile Operations", () => {
  let document: RenownUserDocument;

  beforeEach(() => {
    document = utils.createDocument();
  });

  it("should handle setUsername operation", () => {
    const input: SetUsernameInput = generateMock(z.SetUsernameInputSchema());

    const updatedDocument = reducer(document, creators.setUsername(input));

    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_USERNAME",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
