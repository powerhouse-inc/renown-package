/**
 * This is a scaffold file meant for customization:
 * - change it by adding new tests or modifying the existing ones
 */
/**
 * This is a scaffold file meant for customization:
 * - change it by adding new tests or modifying the existing ones
 */

import {
  assertIsRenownUserDocument,
  assertIsRenownUserState,
  initialGlobalState,
  initialLocalState,
  isRenownUserDocument,
  isRenownUserState,
  renownUserDocumentType,
  utils,
} from "document-models/renown-user/v1";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

describe("RenownUser Document Model", () => {
  it("should create a new RenownUser document", () => {
    const document = utils.createDocument();

    expect(document).toBeDefined();
    expect(document.header.documentType).toBe(renownUserDocumentType);
  });

  it("should create a new RenownUser document with a valid initial state", () => {
    const document = utils.createDocument();
    expect(document.state.global).toStrictEqual(initialGlobalState);
    expect(document.state.local).toStrictEqual(initialLocalState);
    expect(isRenownUserDocument(document)).toBe(true);
    expect(isRenownUserState(document.state)).toBe(true);
  });
  it("should reject a document that is not a RenownUser document", () => {
    const wrongDocumentType = utils.createDocument();
    wrongDocumentType.header.documentType = "the-wrong-thing-1234";
    try {
      expect(assertIsRenownUserDocument(wrongDocumentType)).toThrow();
      expect(isRenownUserDocument(wrongDocumentType)).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(ZodError);
    }
  });
  const wrongState = utils.createDocument();
  wrongState.state.global = {
    // @ts-expect-error - we are testing the error case (username must be a string)
    username: 123,
  };
  try {
    expect(isRenownUserState(wrongState.state)).toBe(false);
    expect(assertIsRenownUserState(wrongState.state)).toThrow();
    expect(isRenownUserDocument(wrongState)).toBe(false);
    expect(assertIsRenownUserDocument(wrongState)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  // NOTE: RenownUserState is all-optional, so a weak fixture like { notWhat: "..." }
  // is zod-stripped to a valid {} — use a type-invalid value to actually fail the
  // guard. This block corrupts .initialState (the previous scaffold checked the
  // untouched .state, which could never fail).
  const wrongInitialState = utils.createDocument();
  wrongInitialState.initialState.global = {
    // @ts-expect-error - we are testing the error case (username must be a string)
    username: 123,
  };
  try {
    expect(isRenownUserState(wrongInitialState.initialState)).toBe(false);
    expect(assertIsRenownUserState(wrongInitialState.initialState)).toThrow();
    expect(isRenownUserDocument(wrongInitialState)).toBe(false);
    expect(assertIsRenownUserDocument(wrongInitialState)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingIdInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingIdInHeader.header.id;
  try {
    expect(isRenownUserDocument(missingIdInHeader)).toBe(false);
    expect(assertIsRenownUserDocument(missingIdInHeader)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingNameInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingNameInHeader.header.name;
  try {
    expect(isRenownUserDocument(missingNameInHeader)).toBe(false);
    expect(assertIsRenownUserDocument(missingNameInHeader)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingCreatedAtUtcIsoInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingCreatedAtUtcIsoInHeader.header.createdAtUtcIso;
  try {
    expect(isRenownUserDocument(missingCreatedAtUtcIsoInHeader)).toBe(false);
    expect(
      assertIsRenownUserDocument(missingCreatedAtUtcIsoInHeader),
    ).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingLastModifiedAtUtcIsoInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingLastModifiedAtUtcIsoInHeader.header.lastModifiedAtUtcIso;
  try {
    expect(isRenownUserDocument(missingLastModifiedAtUtcIsoInHeader)).toBe(
      false,
    );
    expect(
      assertIsRenownUserDocument(missingLastModifiedAtUtcIsoInHeader),
    ).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }
});
