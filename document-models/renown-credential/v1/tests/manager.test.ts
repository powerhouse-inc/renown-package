import { generateMock } from "document-model";
import {
  init,
  InitInputSchema,
  isRenownCredentialDocument,
  reducer,
  revoke,
  RevokeInputSchema,
  utils,
} from "document-models/renown-credential/v1";
import { describe, expect, it } from "vitest";

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
