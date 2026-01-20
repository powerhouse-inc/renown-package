import { generateMock } from "@powerhousedao/codegen";
import { describe, expect, it } from "vitest";
import {
  reducer,
  utils,
  isRenownCredentialDocument,
  init,
  revoke,
  InitInputSchema,
  RevokeInputSchema,
} from "@powerhousedao/renown-package/document-models/renown-credential";

describe("ManagerOperations", () => {
  it("should handle init operation", () => {
    const document = utils.createDocument();
    const input = generateMock(InitInputSchema());

    const updatedDocument = reducer(document, init(input));

    expect(isRenownCredentialDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe("INIT");
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle revoke operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RevokeInputSchema());

    const updatedDocument = reducer(document, revoke(input));

    expect(isRenownCredentialDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe("REVOKE");
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
