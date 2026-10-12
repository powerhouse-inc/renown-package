/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { baseActions } from "document-model";
import {
  renownOrganizationAppsActions,
  renownOrganizationDomainsActions,
  renownOrganizationMembersActions,
  renownOrganizationProfileActions,
  renownOrganizationSecurityActions,
} from "./gen/creators.js";

/** Actions for the RenownOrganization document model */

export const actions = {
  ...baseActions,
  ...renownOrganizationProfileActions,
  ...renownOrganizationMembersActions,
  ...renownOrganizationAppsActions,
  ...renownOrganizationDomainsActions,
  ...renownOrganizationSecurityActions,
};
