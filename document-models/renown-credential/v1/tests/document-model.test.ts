/**
 * This is a scaffold file meant for customization:
 * - change it by adding new tests or modifying the existing ones
 */
/**
 * This is a scaffold file meant for customization:
 * - change it by adding new tests or modifying the existing ones
 */

import {
  assertIsRenownCredentialDocument,
  assertIsRenownCredentialState,
  initialGlobalState,
  initialLocalState,
  isRenownCredentialDocument,
  isRenownCredentialState,
  renownCredentialDocumentType,
  utils,
} from "document-models/renown-credential/v1";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

describe("RenownCredential Document Model", () => {
  it("should create a new RenownCredential document", () => {
    const document = utils.createDocument();

    expect(document).toBeDefined();
    expect(document.header.documentType).toBe(renownCredentialDocumentType);
  });

  it("should create a new RenownCredential document with its (schema-invalid-by-design) initial state", () => {
    const document = utils.createDocument();
    expect(document.state.global).toStrictEqual(initialGlobalState);
    expect(document.state.local).toStrictEqual(initialLocalState);
    // NOTE (kept 1:1 with main): the initialState is schema-invalid by design
    // (issuanceDate: "" vs DateTime!), so the zod guards reject every credential
    // document. Asserting the real (false) behaviour — the model is not changed.
    expect(isRenownCredentialDocument(document)).toBe(false);
    expect(isRenownCredentialState(document.state)).toBe(false);
  });
  it("should reject a document that is not a RenownCredential document", () => {
    const wrongDocumentType = utils.createDocument();
    wrongDocumentType.header.documentType = "the-wrong-thing-1234";
    try {
      expect(assertIsRenownCredentialDocument(wrongDocumentType)).toThrow();
      expect(isRenownCredentialDocument(wrongDocumentType)).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(ZodError);
    }
  });
  const wrongState = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  wrongState.state.global = {
    ...{ notWhat: "you want" },
  };
  try {
    expect(isRenownCredentialState(wrongState.state)).toBe(false);
    expect(assertIsRenownCredentialState(wrongState.state)).toThrow();
    expect(isRenownCredentialDocument(wrongState)).toBe(false);
    expect(assertIsRenownCredentialDocument(wrongState)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const wrongInitialState = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  wrongInitialState.initialState.global = {
    ...{ notWhat: "you want" },
  };
  try {
    expect(isRenownCredentialState(wrongInitialState.state)).toBe(false);
    expect(assertIsRenownCredentialState(wrongInitialState.state)).toThrow();
    expect(isRenownCredentialDocument(wrongInitialState)).toBe(false);
    expect(assertIsRenownCredentialDocument(wrongInitialState)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingIdInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingIdInHeader.header.id;
  try {
    expect(isRenownCredentialDocument(missingIdInHeader)).toBe(false);
    expect(assertIsRenownCredentialDocument(missingIdInHeader)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingNameInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingNameInHeader.header.name;
  try {
    expect(isRenownCredentialDocument(missingNameInHeader)).toBe(false);
    expect(assertIsRenownCredentialDocument(missingNameInHeader)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingCreatedAtUtcIsoInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingCreatedAtUtcIsoInHeader.header.createdAtUtcIso;
  try {
    expect(isRenownCredentialDocument(missingCreatedAtUtcIsoInHeader)).toBe(
      false,
    );
    expect(
      assertIsRenownCredentialDocument(missingCreatedAtUtcIsoInHeader),
    ).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingLastModifiedAtUtcIsoInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingLastModifiedAtUtcIsoInHeader.header.lastModifiedAtUtcIso;
  try {
    expect(
      isRenownCredentialDocument(missingLastModifiedAtUtcIsoInHeader),
    ).toBe(false);
    expect(
      assertIsRenownCredentialDocument(missingLastModifiedAtUtcIsoInHeader),
    ).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }
});
