import {
  type ProcessorRecord,
  type IProcessorHostModule,
} from "document-drive";
import { type RelationalDbProcessorFilter } from "document-drive";
import { type PHDocumentHeader } from "document-model";
import { RenownCredentialProcessor, type IReactor } from "./index.js";

export interface IProcessorHostModuleWithReactor extends IProcessorHostModule {
  reactor?: IReactor;
}

export const renownCredentialProcessorFactory =
  (module: IProcessorHostModuleWithReactor) =>
  async (driveHeader: PHDocumentHeader): Promise<ProcessorRecord[]> => {
    // Create a namespace for the processor and the provided drive id
    const namespace =
      RenownCredentialProcessor.getNamespace("renown-credential");

    // Create a namespaced db for the processor
    const store =
      await module.relationalDb.createNamespace<RenownCredentialProcessor>(
        namespace
      );

    // Create a filter for the processor
    const filter: RelationalDbProcessorFilter = {
      branch: ["main"],
      documentId: ["*"],
      documentType: ["powerhouse/renown-credential"],
      scope: ["global"],
    };

    // Create the processor with reactor support
    const processor = new RenownCredentialProcessor(
      namespace,
      filter,
      store,
      module.reactor
    );
    return [
      {
        processor,
        filter,
      },
    ];
  };
