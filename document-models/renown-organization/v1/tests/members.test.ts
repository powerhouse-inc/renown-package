import { generateMock } from "document-model/mock";
import {
  addTeam,
  AddTeamInputSchema,
  inviteMember,
  InviteMemberInputSchema,
  isRenownOrganizationDocument,
  reducer,
  removeTeam,
  RemoveTeamInputSchema,
  setMemberAppScope,
  SetMemberAppScopeInputSchema,
  setMemberHidden,
  SetMemberHiddenInputSchema,
  setMemberRole,
  SetMemberRoleInputSchema,
  setMemberStatus,
  SetMemberStatusInputSchema,
  setTeamMembers,
  SetTeamMembersInputSchema,
  updateTeam,
  UpdateTeamInputSchema,
  utils,
} from "document-models/renown-organization/v1";
import { describe, expect, it } from "vitest";

describe("MembersOperations", () => {
  it("should handle inviteMember operation", () => {
    const document = utils.createDocument();
    const input = generateMock(InviteMemberInputSchema());

    const updatedDocument = reducer(document, inviteMember(input));

    expect(isRenownOrganizationDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "INVITE_MEMBER",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setMemberStatus operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetMemberStatusInputSchema());

    const updatedDocument = reducer(document, setMemberStatus(input));

    expect(isRenownOrganizationDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_MEMBER_STATUS",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setMemberRole operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetMemberRoleInputSchema());

    const updatedDocument = reducer(document, setMemberRole(input));

    expect(isRenownOrganizationDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_MEMBER_ROLE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setMemberAppScope operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetMemberAppScopeInputSchema());

    const updatedDocument = reducer(document, setMemberAppScope(input));

    expect(isRenownOrganizationDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_MEMBER_APP_SCOPE",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setMemberHidden operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetMemberHiddenInputSchema());

    const updatedDocument = reducer(document, setMemberHidden(input));

    expect(isRenownOrganizationDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_MEMBER_HIDDEN",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle addTeam operation", () => {
    const document = utils.createDocument();
    const input = generateMock(AddTeamInputSchema());

    const updatedDocument = reducer(document, addTeam(input));

    expect(isRenownOrganizationDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe("ADD_TEAM");
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle updateTeam operation", () => {
    const document = utils.createDocument();
    const input = generateMock(UpdateTeamInputSchema());

    const updatedDocument = reducer(document, updateTeam(input));

    expect(isRenownOrganizationDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "UPDATE_TEAM",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle removeTeam operation", () => {
    const document = utils.createDocument();
    const input = generateMock(RemoveTeamInputSchema());

    const updatedDocument = reducer(document, removeTeam(input));

    expect(isRenownOrganizationDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "REMOVE_TEAM",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });

  it("should handle setTeamMembers operation", () => {
    const document = utils.createDocument();
    const input = generateMock(SetTeamMembersInputSchema());

    const updatedDocument = reducer(document, setTeamMembers(input));

    expect(isRenownOrganizationDocument(updatedDocument)).toBe(true);
    expect(updatedDocument.operations.global).toHaveLength(1);
    expect(updatedDocument.operations.global[0].action.type).toBe(
      "SET_TEAM_MEMBERS",
    );
    expect(updatedDocument.operations.global[0].action.input).toStrictEqual(
      input,
    );
    expect(updatedDocument.operations.global[0].index).toEqual(0);
  });
});
