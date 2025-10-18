import type { RenownUserAuthorizationOperations } from "../../gen/authorization/operations.js";
import { AuthorizationNotFoundError } from "../../gen/authorization/error.js";

export const reducer: RenownUserAuthorizationOperations = {
    addAuthorizationOperation(state, action, dispatch) {
        const newAuthorization = {
          id: action.input.id,
          jwt: action.input.jwt,
          issuer: action.input.issuer || null,
          subject: action.input.subject || null,
          audience: action.input.audience || null,
          payload: action.input.payload || null,
          revoked: false,
          createdAt: action.input.createdAt,
          revokedAt: null
        };

        state.authorizations.push(newAuthorization);
    },
    revokeAuthorizationOperation(state, action, dispatch) {
        const authIndex = state.authorizations.findIndex(auth => auth.id === action.input.id);

        if (authIndex === -1) {
          throw new AuthorizationNotFoundError(`Authorization with ID ${action.input.id} not found`);
        }

        state.authorizations[authIndex].revoked = true;
        state.authorizations[authIndex].revokedAt = action.input.revokedAt;
    },
    removeAuthorizationOperation(state, action, dispatch) {
        const authIndex = state.authorizations.findIndex(auth => auth.id === action.input.id);

        if (authIndex === -1) {
          throw new AuthorizationNotFoundError(`Authorization with ID ${action.input.id} not found`);
        }

        state.authorizations.splice(authIndex, 1);
    }
};
