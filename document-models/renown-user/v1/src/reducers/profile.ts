import type { RenownUserProfileOperations } from "document-models/renown-user/v1";

export const renownUserProfileOperations: RenownUserProfileOperations = {
  setUsernameOperation(state, action, dispatch) {
    state.username = action.input.username;
  },
  setEthAddressOperation(state, action, dispatch) {
    state.ethAddress = action.input.ethAddress;
  },
  setUserImageOperation(state, action, dispatch) {
    state.userImage = action.input.userImage;
  },
};
