/**
 * This is a scaffold file meant for customization:
 * - change it by adding new tests or modifying the existing ones
 */
/**
 * This is a scaffold file meant for customization:
 * - change it by adding new tests or modifying the existing ones
 */

import {
  assertIsRenownOrganizationDocument,
  assertIsRenownOrganizationState,
  initialGlobalState,
  initialLocalState,
  isRenownOrganizationDocument,
  isRenownOrganizationState,
  renownOrganizationDocumentType,
  utils,
} from "document-models/renown-organization/v1";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

describe("RenownOrganization Document Model", () => {
  it("should create a new RenownOrganization document", () => {
    const document = utils.createDocument();

    expect(document).toBeDefined();
    expect(document.header.documentType).toBe(renownOrganizationDocumentType);
  });

  it("should create a new RenownOrganization document with a valid initial state", () => {
    const document = utils.createDocument();
    expect(document.state.global).toStrictEqual(initialGlobalState);
    expect(document.state.local).toStrictEqual(initialLocalState);
    expect(isRenownOrganizationDocument(document)).toBe(true);
    expect(isRenownOrganizationState(document.state)).toBe(true);
  });
  it("should reject a document that is not a RenownOrganization document", () => {
    const wrongDocumentType = utils.createDocument();
    wrongDocumentType.header.documentType = "the-wrong-thing-1234";
    try {
      expect(assertIsRenownOrganizationDocument(wrongDocumentType)).toThrow();
      expect(isRenownOrganizationDocument(wrongDocumentType)).toBe(false);
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
    expect(isRenownOrganizationState(wrongState.state)).toBe(false);
    expect(assertIsRenownOrganizationState(wrongState.state)).toThrow();
    expect(isRenownOrganizationDocument(wrongState)).toBe(false);
    expect(assertIsRenownOrganizationDocument(wrongState)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const wrongInitialState = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  wrongInitialState.initialState.global = {
    ...{ notWhat: "you want" },
  };
  try {
    expect(isRenownOrganizationState(wrongInitialState.state)).toBe(false);
    expect(assertIsRenownOrganizationState(wrongInitialState.state)).toThrow();
    expect(isRenownOrganizationDocument(wrongInitialState)).toBe(false);
    expect(assertIsRenownOrganizationDocument(wrongInitialState)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingIdInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingIdInHeader.header.id;
  try {
    expect(isRenownOrganizationDocument(missingIdInHeader)).toBe(false);
    expect(assertIsRenownOrganizationDocument(missingIdInHeader)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingNameInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingNameInHeader.header.name;
  try {
    expect(isRenownOrganizationDocument(missingNameInHeader)).toBe(false);
    expect(assertIsRenownOrganizationDocument(missingNameInHeader)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingCreatedAtUtcIsoInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingCreatedAtUtcIsoInHeader.header.createdAtUtcIso;
  try {
    expect(isRenownOrganizationDocument(missingCreatedAtUtcIsoInHeader)).toBe(
      false,
    );
    expect(
      assertIsRenownOrganizationDocument(missingCreatedAtUtcIsoInHeader),
    ).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingLastModifiedAtUtcIsoInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingLastModifiedAtUtcIsoInHeader.header.lastModifiedAtUtcIso;
  try {
    expect(
      isRenownOrganizationDocument(missingLastModifiedAtUtcIsoInHeader),
    ).toBe(false);
    expect(
      assertIsRenownOrganizationDocument(missingLastModifiedAtUtcIsoInHeader),
    ).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }
});
