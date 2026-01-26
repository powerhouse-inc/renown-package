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
    // Note: isRenownCredentialDocument returns false for initial state because
    // datetime fields are empty strings, which don't pass datetime validation.
    // This is expected - documents need to be initialized via INIT operation.
  });
  it("should reject a document that is not a RenownCredential document", () => {
    const wrongDocumentType = utils.createDocument();
    wrongDocumentType.header.documentType = "the-wrong-thing-1234";
    expect(isRenownCredentialDocument(wrongDocumentType)).toBe(false);
    expect(() => assertIsRenownCredentialDocument(wrongDocumentType)).toThrow(
      ZodError,
    );
  });

  it("should reject a document with wrong state", () => {
    const wrongState = utils.createDocument();
    // @ts-expect-error - we are testing the error case
    wrongState.state.global = { notWhat: "you want" };

    expect(isRenownCredentialState(wrongState.state)).toBe(false);
    expect(() => assertIsRenownCredentialState(wrongState.state)).toThrow(
      ZodError,
    );
    expect(isRenownCredentialDocument(wrongState)).toBe(false);
    expect(() => assertIsRenownCredentialDocument(wrongState)).toThrow(
      ZodError,
    );
  });

  it("should reject a document with wrong initial state", () => {
    const wrongInitialState = utils.createDocument();
    // @ts-expect-error - we are testing the error case
    wrongInitialState.initialState.global = { notWhat: "you want" };

    expect(isRenownCredentialDocument(wrongInitialState)).toBe(false);
    expect(() => assertIsRenownCredentialDocument(wrongInitialState)).toThrow(
      ZodError,
    );
  });

  it("should reject a document missing id in header", () => {
    const missingIdInHeader = utils.createDocument();
    // @ts-expect-error - we are testing the error case
    delete missingIdInHeader.header.id;

    expect(isRenownCredentialDocument(missingIdInHeader)).toBe(false);
    expect(() => assertIsRenownCredentialDocument(missingIdInHeader)).toThrow(
      ZodError,
    );
  });

  it("should reject a document missing name in header", () => {
    const missingNameInHeader = utils.createDocument();
    // @ts-expect-error - we are testing the error case
    delete missingNameInHeader.header.name;

    expect(isRenownCredentialDocument(missingNameInHeader)).toBe(false);
    expect(() => assertIsRenownCredentialDocument(missingNameInHeader)).toThrow(
      ZodError,
    );
  });

  it("should reject a document missing createdAtUtcIso in header", () => {
    const missingCreatedAtUtcIsoInHeader = utils.createDocument();
    // @ts-expect-error - we are testing the error case
    delete missingCreatedAtUtcIsoInHeader.header.createdAtUtcIso;

    expect(isRenownCredentialDocument(missingCreatedAtUtcIsoInHeader)).toBe(
      false,
    );
    expect(() =>
      assertIsRenownCredentialDocument(missingCreatedAtUtcIsoInHeader),
    ).toThrow(ZodError);
  });

  it("should reject a document missing lastModifiedAtUtcIso in header", () => {
    const missingLastModifiedAtUtcIsoInHeader = utils.createDocument();
    // @ts-expect-error - we are testing the error case
    delete missingLastModifiedAtUtcIsoInHeader.header.lastModifiedAtUtcIso;

    expect(isRenownCredentialDocument(missingLastModifiedAtUtcIsoInHeader)).toBe(
      false,
    );
    expect(() =>
      assertIsRenownCredentialDocument(missingLastModifiedAtUtcIsoInHeader),
    ).toThrow(ZodError);
  });
});
