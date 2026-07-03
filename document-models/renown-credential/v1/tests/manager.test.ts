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

// NOTE (kept 1:1 with main): the RenownCredential model's initialState is
// schema-invalid by design (issuanceDate: "" vs DateTime!), so the generated zod
// doc-guard `isRenownCredentialDocument` returns false for EVERY credential
// document — fresh or after any operation. These tests therefore assert the real
// (false) behaviour. The model is intentionally NOT changed to make the guard pass.
describe("ManagerOperations", () => {
  it("should handle init operation", () => {
    const document = utils.createDocument();
    const input = generateMock(InitInputSchema());

    const updatedDocument = reducer(document, init(input));

    expect(isRenownCredentialDocument(updatedDocument)).toBe(false); // 1:1 quirk — see note above
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

    expect(isRenownCredentialDocument(updatedDocument)).toBe(false); // 1:1 quirk — see note above
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe("REVOKE");
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
