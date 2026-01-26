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
  renownUserDocumentType,
  isRenownUserDocument,
  assertIsRenownUserDocument,
  isRenownUserState,
  assertIsRenownUserState,
} from "@powerhousedao/renown-package/document-models/renown-user";
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
    expect(isRenownUserDocument(wrongDocumentType)).toBe(false);
    expect(() => assertIsRenownUserDocument(wrongDocumentType)).toThrow(
      ZodError,
    );
  });

  it("should reject a document with invalid ethAddress format", () => {
    const invalidState = utils.createDocument();
    // Invalid Ethereum address format
    invalidState.state.global.ethAddress = "not-a-valid-address";

    expect(isRenownUserState(invalidState.state)).toBe(false);
    expect(() => assertIsRenownUserState(invalidState.state)).toThrow(ZodError);
    expect(isRenownUserDocument(invalidState)).toBe(false);
    expect(() => assertIsRenownUserDocument(invalidState)).toThrow(ZodError);
  });

  it("should reject a document with invalid initial state ethAddress", () => {
    const invalidInitialState = utils.createDocument();
    // Invalid Ethereum address format in initial state
    invalidInitialState.initialState.global.ethAddress = "not-a-valid-address";

    expect(isRenownUserDocument(invalidInitialState)).toBe(false);
    expect(() => assertIsRenownUserDocument(invalidInitialState)).toThrow(
      ZodError,
    );
  });

  it("should reject a document missing id in header", () => {
    const missingIdInHeader = utils.createDocument();
    // @ts-expect-error - we are testing the error case
    delete missingIdInHeader.header.id;

    expect(isRenownUserDocument(missingIdInHeader)).toBe(false);
    expect(() => assertIsRenownUserDocument(missingIdInHeader)).toThrow(
      ZodError,
    );
  });

  it("should reject a document missing name in header", () => {
    const missingNameInHeader = utils.createDocument();
    // @ts-expect-error - we are testing the error case
    delete missingNameInHeader.header.name;

    expect(isRenownUserDocument(missingNameInHeader)).toBe(false);
    expect(() => assertIsRenownUserDocument(missingNameInHeader)).toThrow(
      ZodError,
    );
  });

  it("should reject a document missing createdAtUtcIso in header", () => {
    const missingCreatedAtUtcIsoInHeader = utils.createDocument();
    // @ts-expect-error - we are testing the error case
    delete missingCreatedAtUtcIsoInHeader.header.createdAtUtcIso;

    expect(isRenownUserDocument(missingCreatedAtUtcIsoInHeader)).toBe(false);
    expect(() =>
      assertIsRenownUserDocument(missingCreatedAtUtcIsoInHeader),
    ).toThrow(ZodError);
  });

  it("should reject a document missing lastModifiedAtUtcIso in header", () => {
    const missingLastModifiedAtUtcIsoInHeader = utils.createDocument();
    // @ts-expect-error - we are testing the error case
    delete missingLastModifiedAtUtcIsoInHeader.header.lastModifiedAtUtcIso;

    expect(isRenownUserDocument(missingLastModifiedAtUtcIsoInHeader)).toBe(
      false,
    );
    expect(() =>
      assertIsRenownUserDocument(missingLastModifiedAtUtcIsoInHeader),
    ).toThrow(ZodError);
  });
});
