import type { RenownUserProfileOperations } from "document-models/renown-user/v1";

export const renownUserProfileOperations: RenownUserProfileOperations = {
  setUsernameOperation(state, action) {
    state.username = action.input.username;
  },
  setEthAddressOperation(state, action) {
    state.ethAddress = action.input.ethAddress;
  },
  setUserImageOperation(state, action) {
    state.userImage = action.input.userImage;
  },
};
