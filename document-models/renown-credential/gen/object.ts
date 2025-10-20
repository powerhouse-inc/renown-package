import {
  BaseDocumentClass,
  applyMixins,
  type SignalDispatch,
} from "document-model";
import { type RenownCredentialPHState } from "./ph-factories.js";
import { type RenownCredentialAction } from "./actions.js";
import { reducer } from "./reducer.js";
import { createDocument } from "./utils.js";
import RenownCredential_Manager from "./manager/object.js";

export * from "./manager/object.js";

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
interface RenownCredential extends RenownCredential_Manager {}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
class RenownCredential extends BaseDocumentClass<RenownCredentialPHState> {
  static fileExtension = "phrc";

  constructor(
    initialState?: Partial<RenownCredentialPHState>,
    dispatch?: SignalDispatch,
  ) {
    super(reducer, createDocument(initialState), dispatch);
  }

  public saveToFile(path: string, name?: string) {
    return super.saveToFile(path, RenownCredential.fileExtension, name);
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

applyMixins(RenownCredential, [RenownCredential_Manager]);

export { RenownCredential };
