import type { RenownOrganizationSecurityOperations } from "document-models/renown-organization/v1";
import { CredentialNotSuspendedError } from "../../gen/security/error.js";

export const renownOrganizationSecurityOperations: RenownOrganizationSecurityOperations = {
  suspendCredentialsOperation(state, action) {
    for (const id of action.input.credentialIds) {
      if (!state.suspendedCredentialIds.includes(id)) state.suspendedCredentialIds.push(id);
    }
  },
  unsuspendCredentialOperation(state, action) {
    const { credentialId } = action.input;
    const index = state.suspendedCredentialIds.indexOf(credentialId);
    if (index === -1) throw new CredentialNotSuspendedError(`Credential ${credentialId} is not suspended`);
    state.suspendedCredentialIds.splice(index, 1);
  },
};
