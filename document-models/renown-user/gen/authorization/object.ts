import { BaseDocumentClass } from "document-model";
import { RenownUserPHState } from "../ph-factories.js";
import {
  type AddAuthorizationInput,
  type RevokeAuthorizationInput,
  type RemoveAuthorizationInput,
} from "../types.js";
import {
  addAuthorization,
  revokeAuthorization,
  removeAuthorization,
} from "./creators.js";
import { type RenownUserAction } from "../actions.js";

export default class RenownUser_Authorization extends BaseDocumentClass<RenownUserPHState> {
  public addAuthorization(input: AddAuthorizationInput) {
    return this.dispatch(addAuthorization(input));
  }

  public revokeAuthorization(input: RevokeAuthorizationInput) {
    return this.dispatch(revokeAuthorization(input));
  }

  public removeAuthorization(input: RemoveAuthorizationInput) {
    return this.dispatch(removeAuthorization(input));
  }
}
