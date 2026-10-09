/**
 * This is a scaffold file meant for customization:
 * - change it by adding new tests or modifying the existing ones
 */
/**
 * This is a scaffold file meant for customization:
 * - change it by adding new tests or modifying the existing ones
 */

import {
  assertIsRenownAppProfileDocument,
  assertIsRenownAppProfileState,
  initialGlobalState,
  initialLocalState,
  isRenownAppProfileDocument,
  isRenownAppProfileState,
  renownAppProfileDocumentType,
  utils,
} from "document-models/renown-app-profile/v1";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

describe("RenownAppProfile Document Model", () => {
  it("should create a new RenownAppProfile document", () => {
    const document = utils.createDocument();

    expect(document).toBeDefined();
    expect(document.header.documentType).toBe(renownAppProfileDocumentType);
  });

  it("should create a new RenownAppProfile document with a valid initial state", () => {
    const document = utils.createDocument();
    expect(document.state.global).toStrictEqual(initialGlobalState);
    expect(document.state.local).toStrictEqual(initialLocalState);
    expect(isRenownAppProfileDocument(document)).toBe(true);
    expect(isRenownAppProfileState(document.state)).toBe(true);
  });
  it("should reject a document that is not a RenownAppProfile document", () => {
    const wrongDocumentType = utils.createDocument();
    wrongDocumentType.header.documentType = "the-wrong-thing-1234";
    try {
      expect(assertIsRenownAppProfileDocument(wrongDocumentType)).toThrow();
      expect(isRenownAppProfileDocument(wrongDocumentType)).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(ZodError);
    }
  });
  const wrongState = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  wrongState.state.global = {
    ...{ appDid: 123 }, // every field is nullable, so only a wrong type is invalid
  };
  try {
    expect(isRenownAppProfileState(wrongState.state)).toBe(false);
    expect(assertIsRenownAppProfileState(wrongState.state)).toThrow();
    expect(isRenownAppProfileDocument(wrongState)).toBe(false);
    expect(assertIsRenownAppProfileDocument(wrongState)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const wrongInitialState = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  wrongInitialState.initialState.global = {
    ...{ appDid: 123 }, // every field is nullable, so only a wrong type is invalid
  };
  try {
    expect(isRenownAppProfileState(wrongInitialState.state)).toBe(false);
    expect(assertIsRenownAppProfileState(wrongInitialState.state)).toThrow();
    expect(isRenownAppProfileDocument(wrongInitialState)).toBe(false);
    expect(assertIsRenownAppProfileDocument(wrongInitialState)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingIdInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingIdInHeader.header.id;
  try {
    expect(isRenownAppProfileDocument(missingIdInHeader)).toBe(false);
    expect(assertIsRenownAppProfileDocument(missingIdInHeader)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingNameInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingNameInHeader.header.name;
  try {
    expect(isRenownAppProfileDocument(missingNameInHeader)).toBe(false);
    expect(assertIsRenownAppProfileDocument(missingNameInHeader)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingCreatedAtUtcIsoInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingCreatedAtUtcIsoInHeader.header.createdAtUtcIso;
  try {
    expect(isRenownAppProfileDocument(missingCreatedAtUtcIsoInHeader)).toBe(
      false,
    );
    expect(
      assertIsRenownAppProfileDocument(missingCreatedAtUtcIsoInHeader),
    ).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingLastModifiedAtUtcIsoInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingLastModifiedAtUtcIsoInHeader.header.lastModifiedAtUtcIso;
  try {
    expect(
      isRenownAppProfileDocument(missingLastModifiedAtUtcIsoInHeader),
    ).toBe(false);
    expect(
      assertIsRenownAppProfileDocument(missingLastModifiedAtUtcIsoInHeader),
    ).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }
});
