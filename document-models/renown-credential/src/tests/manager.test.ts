/**
 * This is a scaffold file meant for customization:
 * - change it by adding new tests or modifying the existing ones
 */

import { describe, it, expect, beforeEach } from "vitest";
import { generateMock } from "@powerhousedao/codegen";
import { utils } from "../../gen/utils.js";
import type { InitInput, RevokeInput } from "../../gen/schema/index.js";
import { InitInputSchema, RevokeInputSchema } from "../../gen/schema/zod.js";
import { reducer } from "../../gen/reducer.js";
import * as creators from "../../gen/manager/creators.js";
import type { RenownCredentialDocument } from "../../gen/types.js";

describe("Manager Operations", () => {
  let document: RenownCredentialDocument;

  beforeEach(() => {
    document = utils.createDocument();
  });

  it("should handle init operation", () => {
    const input: InitInput = generateMock(InitInputSchema());

    const updatedDocument = reducer(document, creators.init(input));

    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe("INIT");
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
  it("should handle revoke operation", () => {
    const input: RevokeInput = generateMock(RevokeInputSchema());

    const updatedDocument = reducer(document, creators.revoke(input));

    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe("REVOKE");
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
