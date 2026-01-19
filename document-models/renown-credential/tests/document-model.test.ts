/**
 * This is a scaffold file meant for customization:
 * - change it by adding new tests or modifying the existing ones
 */
/**
 * This is a scaffold file meant for customization:
 * - change it by adding new tests or modifying the existing ones
 */

import { describe, it, expect } from "vitest";
import {
  utils,
  initialGlobalState,
  initialLocalState,
  renownCredentialDocumentType,
  isRenownCredentialDocument,
  assertIsRenownCredentialDocument,
  isRenownCredentialState,
  assertIsRenownCredentialState,
} from "@powerhousedao/renown-package/document-models/renown-credential";
import { ZodError } from "zod";

describe("RenownCredential Document Model", () => {
  it("should create a new RenownCredential document", () => {
    const document = utils.createDocument();

    expect(document).toBeDefined();
    expect(document.header.documentType).toBe(renownCredentialDocumentType);
  });

  it("should create a new RenownCredential document with a valid initial state", () => {
    const document = utils.createDocument();
    expect(document.state.global).toStrictEqual(initialGlobalState);
    expect(document.state.local).toStrictEqual(initialLocalState);
    expect(isRenownCredentialDocument(document)).toBe(true);
    expect(isRenownCredentialState(document.state)).toBe(true);
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
