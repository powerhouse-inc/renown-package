/**
 * This is a scaffold file meant for customization:
 * - change it by adding new tests or modifying the existing ones
 */
/**
 * This is a scaffold file meant for customization:
 * - change it by adding new tests or modifying the existing ones
 */

import {
  assertIsRenownOidcClientDocument,
  assertIsRenownOidcClientState,
  initialGlobalState,
  initialLocalState,
  isRenownOidcClientDocument,
  isRenownOidcClientState,
  renownOidcClientDocumentType,
  utils,
} from "document-models/renown-oidc-client/v1";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

describe("RenownOidcClient Document Model", () => {
  it("should create a new RenownOidcClient document", () => {
    const document = utils.createDocument();

    expect(document).toBeDefined();
    expect(document.header.documentType).toBe(renownOidcClientDocumentType);
  });

  it("should create a new RenownOidcClient document with a valid initial state", () => {
    const document = utils.createDocument();
    expect(document.state.global).toStrictEqual(initialGlobalState);
    expect(document.state.local).toStrictEqual(initialLocalState);
    expect(isRenownOidcClientDocument(document)).toBe(true);
    expect(isRenownOidcClientState(document.state)).toBe(true);
  });
  it("should reject a document that is not a RenownOidcClient document", () => {
    const wrongDocumentType = utils.createDocument();
    wrongDocumentType.header.documentType = "the-wrong-thing-1234";
    try {
      expect(assertIsRenownOidcClientDocument(wrongDocumentType)).toThrow();
      expect(isRenownOidcClientDocument(wrongDocumentType)).toBe(false);
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
    expect(isRenownOidcClientState(wrongState.state)).toBe(false);
    expect(assertIsRenownOidcClientState(wrongState.state)).toThrow();
    expect(isRenownOidcClientDocument(wrongState)).toBe(false);
    expect(assertIsRenownOidcClientDocument(wrongState)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const wrongInitialState = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  wrongInitialState.initialState.global = {
    ...{ notWhat: "you want" },
  };
  try {
    expect(isRenownOidcClientState(wrongInitialState.state)).toBe(false);
    expect(assertIsRenownOidcClientState(wrongInitialState.state)).toThrow();
    expect(isRenownOidcClientDocument(wrongInitialState)).toBe(false);
    expect(assertIsRenownOidcClientDocument(wrongInitialState)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingIdInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingIdInHeader.header.id;
  try {
    expect(isRenownOidcClientDocument(missingIdInHeader)).toBe(false);
    expect(assertIsRenownOidcClientDocument(missingIdInHeader)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingNameInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingNameInHeader.header.name;
  try {
    expect(isRenownOidcClientDocument(missingNameInHeader)).toBe(false);
    expect(assertIsRenownOidcClientDocument(missingNameInHeader)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingCreatedAtUtcIsoInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingCreatedAtUtcIsoInHeader.header.createdAtUtcIso;
  try {
    expect(isRenownOidcClientDocument(missingCreatedAtUtcIsoInHeader)).toBe(
      false,
    );
    expect(
      assertIsRenownOidcClientDocument(missingCreatedAtUtcIsoInHeader),
    ).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingLastModifiedAtUtcIsoInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingLastModifiedAtUtcIsoInHeader.header.lastModifiedAtUtcIso;
  try {
    expect(
      isRenownOidcClientDocument(missingLastModifiedAtUtcIsoInHeader),
    ).toBe(false);
    expect(
      assertIsRenownOidcClientDocument(missingLastModifiedAtUtcIsoInHeader),
    ).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }
});
