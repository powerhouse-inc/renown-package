import { BaseDocumentClass } from "document-model";
import { RenownUserPHState } from "../ph-factories.js";
import {
  type SetUsernameInput,
  type SetEthAddressInput,
  type SetUserImageInput,
} from "../types.js";
import { setUsername, setEthAddress, setUserImage } from "./creators.js";
import { type RenownUserAction } from "../actions.js";

export default class RenownUser_Profile extends BaseDocumentClass<RenownUserPHState> {
  public setUsername(input: SetUsernameInput) {
    return this.dispatch(setUsername(input));
  }

  public setEthAddress(input: SetEthAddressInput) {
    return this.dispatch(setEthAddress(input));
  }

  public setUserImage(input: SetUserImageInput) {
    return this.dispatch(setUserImage(input));
  }
}
