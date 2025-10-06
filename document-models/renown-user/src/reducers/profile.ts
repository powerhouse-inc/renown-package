import type { RenownUserProfileOperations } from "../../gen/profile/operations.js";

export const reducer: RenownUserProfileOperations = {
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
