import {
  type ProcessorRecord,
  type IProcessorHostModule,
} from "document-drive";
import { type RelationalDbProcessorFilter } from "document-drive";
import { type PHDocumentHeader } from "document-model";
import { RenownUserProcessor } from "./index.js";

export const renownUserProcessorFactory =
  (module: IProcessorHostModule) =>
  async (driveHeader: PHDocumentHeader): Promise<ProcessorRecord[]> => {
    // Create a namespace for the processor and the provided drive id
    const namespace = RenownUserProcessor.getNamespace(driveHeader.id);

    // Create a namespaced db for the processor
    const store =
      await module.relationalDb.createNamespace<RenownUserProcessor>(namespace);

    // Create a filter for the processor
    const filter: RelationalDbProcessorFilter = {
      branch: ["main"],
      documentId: ["*"],
      documentType: ["powerhouse/renown-user"],
      scope: ["global"],
    };

    // Create the processor
    const processor = new RenownUserProcessor(namespace, filter, store);
    return [
      {
        processor,
        filter,
      },
    ];
  };
