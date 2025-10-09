import type { RenownCredentialManagerOperations } from "../../gen/manager/operations.js";

export const reducer: RenownCredentialManagerOperations = {
  initOperation(state, action, dispatch) {
    const { issuer, subject, jwt, audience, payload } = action.input;
    const credential = {
      issuer: issuer || null,
      subject: subject || null,
      jwt,
      revoked: false,
      audience: audience || null,
      payload: payload || null,
    };

    state = {
      ...state,
      ...credential,
    };
  },
  revokeOperation(state, action, dispatch) {
    const { jwt } = action.input;
    state.revoked = true;
    state.jwt = jwt || null;
    return state;
  },
};
