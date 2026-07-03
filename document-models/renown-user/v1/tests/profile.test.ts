import { generateMock } from "document-model";
import {
  isRenownUserDocument,
  reducer,
  setEthAddress,
  SetEthAddressInputSchema,
  setUserImage,
  SetUserImageInputSchema,
  setUsername,
  SetUsernameInputSchema,
  utils,
} from "document-models/renown-user/v1";
import { describe, expect, it } from "vitest";

describe("ProfileOperations", () => {
  it("should handle setUsername operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetUsernameInputSchema());

    const updatedDocument = reducer(document, setUsername(input));

    expect(isRenownUserDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_USERNAME",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setEthAddress operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetEthAddressInputSchema());

    const updatedDocument = reducer(document, setEthAddress(input));

    expect(isRenownUserDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_ETH_ADDRESS",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setUserImage operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetUserImageInputSchema());

    const updatedDocument = reducer(document, setUserImage(input));

    expect(isRenownUserDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_USER_IMAGE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
