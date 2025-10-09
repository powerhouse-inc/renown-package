import { BaseDocumentClass } from "document-model";
import { RenownCredentialPHState } from "../ph-factories.js";
import { type InitInput, type RevokeInput } from "../types.js";
import { init, revoke } from "./creators.js";
import { type RenownCredentialAction } from "../actions.js";

export default class RenownCredential_Manager extends BaseDocumentClass<RenownCredentialPHState> {
  public init(input: InitInput) {
    return this.dispatch(init(input));
  }

  public revoke(input: RevokeInput) {
    return this.dispatch(revoke(input));
  }
}
