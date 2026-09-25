import { generateMock } from "document-model/mock";
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
    const input = generateMock(InitInputSchema(), {
      issuanceDate: "2024-01-01T00:00:00.000Z",
      expirationDate: "2024-01-01T00:00:00.000Z",
    });

    const updatedDocument = reducer(document, init(input));

    // The spec's initial state has empty DateTime fields, which the schema rejects.
    expect(isRenownCredentialDocument(updatedDocument)).toBe(false);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe("INIT");
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle revoke operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RevokeInputSchema(), {
      revokedAt: "2024-01-01T00:00:00.000Z",
    });

    const updatedDocument = reducer(document, revoke(input));

    // The spec's initial state has empty DateTime fields, which the schema rejects.
    expect(isRenownCredentialDocument(updatedDocument)).toBe(false);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe("REVOKE");
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
