/**
 * This is a scaffold file meant for customization:
 * - change it by adding new tests or modifying the existing ones
 */
/**
 * This is a scaffold file meant for customization:
 * - change it by adding new tests or modifying the existing ones
 */

import {
  assertIsRenownUserStatsDocument,
  assertIsRenownUserStatsState,
  initialGlobalState,
  initialLocalState,
  isRenownUserStatsDocument,
  isRenownUserStatsState,
  renownUserStatsDocumentType,
  utils,
} from "document-models/renown-user-stats/v1";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

describe("RenownUserStats Document Model", () => {
  it("should create a new RenownUserStats document", () => {
    const document = utils.createDocument();

    expect(document).toBeDefined();
    expect(document.header.documentType).toBe(renownUserStatsDocumentType);
  });

  it("should create a new RenownUserStats document with a valid initial state", () => {
    const document = utils.createDocument();
    expect(document.state.global).toStrictEqual(initialGlobalState);
    expect(document.state.local).toStrictEqual(initialLocalState);
    expect(isRenownUserStatsDocument(document)).toBe(true);
    expect(isRenownUserStatsState(document.state)).toBe(true);
  });
  it("should reject a document that is not a RenownUserStats document", () => {
    const wrongDocumentType = utils.createDocument();
    wrongDocumentType.header.documentType = "the-wrong-thing-1234";
    try {
      expect(assertIsRenownUserStatsDocument(wrongDocumentType)).toThrow();
      expect(isRenownUserStatsDocument(wrongDocumentType)).toBe(false);
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
    expect(isRenownUserStatsState(wrongState.state)).toBe(false);
    expect(assertIsRenownUserStatsState(wrongState.state)).toThrow();
    expect(isRenownUserStatsDocument(wrongState)).toBe(false);
    expect(assertIsRenownUserStatsDocument(wrongState)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const wrongInitialState = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  wrongInitialState.initialState.global = {
    ...{ notWhat: "you want" },
  };
  try {
    expect(isRenownUserStatsState(wrongInitialState.state)).toBe(false);
    expect(assertIsRenownUserStatsState(wrongInitialState.state)).toThrow();
    expect(isRenownUserStatsDocument(wrongInitialState)).toBe(false);
    expect(assertIsRenownUserStatsDocument(wrongInitialState)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingIdInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingIdInHeader.header.id;
  try {
    expect(isRenownUserStatsDocument(missingIdInHeader)).toBe(false);
    expect(assertIsRenownUserStatsDocument(missingIdInHeader)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingNameInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingNameInHeader.header.name;
  try {
    expect(isRenownUserStatsDocument(missingNameInHeader)).toBe(false);
    expect(assertIsRenownUserStatsDocument(missingNameInHeader)).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingCreatedAtUtcIsoInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingCreatedAtUtcIsoInHeader.header.createdAtUtcIso;
  try {
    expect(isRenownUserStatsDocument(missingCreatedAtUtcIsoInHeader)).toBe(
      false,
    );
    expect(
      assertIsRenownUserStatsDocument(missingCreatedAtUtcIsoInHeader),
    ).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }

  const missingLastModifiedAtUtcIsoInHeader = utils.createDocument();
  // @ts-expect-error - we are testing the error case
  delete missingLastModifiedAtUtcIsoInHeader.header.lastModifiedAtUtcIso;
  try {
    expect(isRenownUserStatsDocument(missingLastModifiedAtUtcIsoInHeader)).toBe(
      false,
    );
    expect(
      assertIsRenownUserStatsDocument(missingLastModifiedAtUtcIsoInHeader),
    ).toThrow();
  } catch (error) {
    expect(error).toBeInstanceOf(ZodError);
  }
});
