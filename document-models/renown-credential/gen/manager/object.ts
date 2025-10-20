import { BaseDocumentClass } from "document-model";
import { RenownCredentialPHState } from "../ph-factories.js";
import {
  type InitInput,
  type RevokeInput,
  type UpdateCredentialSubjectInput,
  type SetJwtInput,
  type SetCredentialStatusInput,
} from "../types.js";
import {
  init,
  revoke,
  updateCredentialSubject,
  setJwt,
  setCredentialStatus,
} from "./creators.js";
import { type RenownCredentialAction } from "../actions.js";

export default class RenownCredential_Manager extends BaseDocumentClass<RenownCredentialPHState> {
  public init(input: InitInput) {
    return this.dispatch(init(input));
  }

  public revoke(input: RevokeInput) {
    return this.dispatch(revoke(input));
  }

  public updateCredentialSubject(input: UpdateCredentialSubjectInput) {
    return this.dispatch(updateCredentialSubject(input));
  }

  public setJwt(input: SetJwtInput) {
    return this.dispatch(setJwt(input));
  }

  public setCredentialStatus(input: SetCredentialStatusInput) {
    return this.dispatch(setCredentialStatus(input));
  }
}
