import {
  BaseDocumentClass,
  applyMixins,
  type SignalDispatch,
} from "document-model";
import { RenownUserPHState } from "./ph-factories.js";
import { type RenownUserAction } from "./actions.js";
import { reducer } from "./reducer.js";
import { createDocument } from "./utils.js";
import RenownUser_Profile from "./profile/object.js";
import RenownUser_Authorization from "./authorization/object.js";

export * from "./profile/object.js";
export * from "./authorization/object.js";

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
interface RenownUser extends RenownUser_Profile, RenownUser_Authorization {}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
class RenownUser extends BaseDocumentClass<RenownUserPHState> {
  static fileExtension = "phru";

  constructor(
    initialState?: Partial<RenownUserPHState>,
    dispatch?: SignalDispatch,
  ) {
    super(reducer, createDocument(initialState), dispatch);
  }

  public saveToFile(path: string, name?: string) {
    return super.saveToFile(path, RenownUser.fileExtension, name);
  }

  public loadFromFile(path: string) {
    return super.loadFromFile(path);
  }

  static async fromFile(path: string) {
    const document = new this();
    await document.loadFromFile(path);
    return document;
  }
}

applyMixins(RenownUser, [RenownUser_Profile, RenownUser_Authorization]);

export { RenownUser };
