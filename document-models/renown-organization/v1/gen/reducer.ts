/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import type { Reducer, StateReducer } from "document-model";
import { createReducer, isDocumentAction } from "document-model";
import type { RenownOrganizationPHState } from "document-models/renown-organization/v1";

import { renownOrganizationAppsOperations } from "../src/reducers/apps.js";
import { renownOrganizationDomainsOperations } from "../src/reducers/domains.js";
import { renownOrganizationMembersOperations } from "../src/reducers/members.js";
import { renownOrganizationProfileOperations } from "../src/reducers/profile.js";
import { renownOrganizationSecurityOperations } from "../src/reducers/security.js";

import {
  AddDomainInputSchema,
  AddOrgAppInputSchema,
  AddTeamInputSchema,
  ArchiveOrgInputSchema,
  InitOrganizationInputSchema,
  InviteMemberInputSchema,
  RemoveDomainInputSchema,
  RemoveOrgAppInputSchema,
  RemoveTeamInputSchema,
  SetAppFrozenInputSchema,
  SetDomainStatusInputSchema,
  SetMemberAppScopeInputSchema,
  SetMemberHiddenInputSchema,
  SetMemberRoleInputSchema,
  SetMembersPublicInputSchema,
  SetMemberStatusInputSchema,
  SetOrgHandleInputSchema,
  SetOrgListedInputSchema,
  SetOrgProfileInputSchema,
  SetTakenDownInputSchema,
  SetTeamMembersInputSchema,
  SuspendCredentialsInputSchema,
  UnsuspendCredentialInputSchema,
  UpdateTeamInputSchema,
} from "./schema/zod.js";

const schemaMemo = new Map<() => unknown, unknown>();

function memoizedSchema<T>(makeSchema: () => T): T {
  let schema = schemaMemo.get(makeSchema) as T | undefined;
  if (schema === undefined) {
    schema = makeSchema();
    schemaMemo.set(makeSchema, schema);
  }
  return schema;
}

const stateReducer: StateReducer<RenownOrganizationPHState> = (
  state,
  action,
  dispatch,
) => {
  if (isDocumentAction(action)) {
    return state;
  }
  switch (action.type) {
    case "INIT_ORGANIZATION": {
      memoizedSchema(InitOrganizationInputSchema).parse(action.input);

      renownOrganizationProfileOperations.initOrganizationOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_ORG_PROFILE": {
      memoizedSchema(SetOrgProfileInputSchema).parse(action.input);

      renownOrganizationProfileOperations.setOrgProfileOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_ORG_HANDLE": {
      memoizedSchema(SetOrgHandleInputSchema).parse(action.input);

      renownOrganizationProfileOperations.setOrgHandleOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_ORG_LISTED": {
      memoizedSchema(SetOrgListedInputSchema).parse(action.input);

      renownOrganizationProfileOperations.setOrgListedOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_MEMBERS_PUBLIC": {
      memoizedSchema(SetMembersPublicInputSchema).parse(action.input);

      renownOrganizationProfileOperations.setMembersPublicOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ARCHIVE_ORG": {
      memoizedSchema(ArchiveOrgInputSchema).parse(action.input);

      renownOrganizationProfileOperations.archiveOrgOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_TAKEN_DOWN": {
      memoizedSchema(SetTakenDownInputSchema).parse(action.input);

      renownOrganizationProfileOperations.setTakenDownOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "INVITE_MEMBER": {
      memoizedSchema(InviteMemberInputSchema).parse(action.input);

      renownOrganizationMembersOperations.inviteMemberOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_MEMBER_STATUS": {
      memoizedSchema(SetMemberStatusInputSchema).parse(action.input);

      renownOrganizationMembersOperations.setMemberStatusOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_MEMBER_ROLE": {
      memoizedSchema(SetMemberRoleInputSchema).parse(action.input);

      renownOrganizationMembersOperations.setMemberRoleOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_MEMBER_APP_SCOPE": {
      memoizedSchema(SetMemberAppScopeInputSchema).parse(action.input);

      renownOrganizationMembersOperations.setMemberAppScopeOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_MEMBER_HIDDEN": {
      memoizedSchema(SetMemberHiddenInputSchema).parse(action.input);

      renownOrganizationMembersOperations.setMemberHiddenOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ADD_TEAM": {
      memoizedSchema(AddTeamInputSchema).parse(action.input);

      renownOrganizationMembersOperations.addTeamOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "UPDATE_TEAM": {
      memoizedSchema(UpdateTeamInputSchema).parse(action.input);

      renownOrganizationMembersOperations.updateTeamOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "REMOVE_TEAM": {
      memoizedSchema(RemoveTeamInputSchema).parse(action.input);

      renownOrganizationMembersOperations.removeTeamOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_TEAM_MEMBERS": {
      memoizedSchema(SetTeamMembersInputSchema).parse(action.input);

      renownOrganizationMembersOperations.setTeamMembersOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ADD_ORG_APP": {
      memoizedSchema(AddOrgAppInputSchema).parse(action.input);

      renownOrganizationAppsOperations.addOrgAppOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "REMOVE_ORG_APP": {
      memoizedSchema(RemoveOrgAppInputSchema).parse(action.input);

      renownOrganizationAppsOperations.removeOrgAppOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_APP_FROZEN": {
      memoizedSchema(SetAppFrozenInputSchema).parse(action.input);

      renownOrganizationAppsOperations.setAppFrozenOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "ADD_DOMAIN": {
      memoizedSchema(AddDomainInputSchema).parse(action.input);

      renownOrganizationDomainsOperations.addDomainOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SET_DOMAIN_STATUS": {
      memoizedSchema(SetDomainStatusInputSchema).parse(action.input);

      renownOrganizationDomainsOperations.setDomainStatusOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "REMOVE_DOMAIN": {
      memoizedSchema(RemoveDomainInputSchema).parse(action.input);

      renownOrganizationDomainsOperations.removeDomainOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "SUSPEND_CREDENTIALS": {
      memoizedSchema(SuspendCredentialsInputSchema).parse(action.input);

      renownOrganizationSecurityOperations.suspendCredentialsOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    case "UNSUSPEND_CREDENTIAL": {
      memoizedSchema(UnsuspendCredentialInputSchema).parse(action.input);

      renownOrganizationSecurityOperations.unsuspendCredentialOperation(
        (state as any)[action.scope],
        action as any,
        dispatch,
      );

      break;
    }

    default:
      return state;
  }
};

export const reducer: Reducer<RenownOrganizationPHState> =
  createReducer(stateReducer);
