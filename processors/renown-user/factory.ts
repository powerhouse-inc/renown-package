import type {
  IProcessorHostModule,
  ProcessorApp,
  ProcessorFactoryBuilder,
  ProcessorFilter,
} from "@powerhousedao/reactor-browser";
import type { PHDocumentHeader } from "document-model";
import { RenownUser } from "./processor.js";

export const renownUserFactoryBuilder: ProcessorFactoryBuilder =
  (module: IProcessorHostModule) =>
  async (driveHeader: PHDocumentHeader, processorApp?: ProcessorApp) => {
    // Create a namespace for the processor and the provided drive id
    const namespace = RenownUser.getNamespace(driveHeader.id);

    // Create a namespaced db for the processor
    const store =
      await module.relationalDb.createNamespace<RenownUser>(namespace);

    // Create a filter for the processor
    const filter: ProcessorFilter = {
      branch: ["main"],
      documentId: ["*"],
      documentType: ["powerhouse/renown-user"],
      scope: ["global"],
    };

    // Create the processor
    const processor = new RenownUser(namespace, filter, store);
    return [
      {
        processor,
        filter,
      },
    ];
  };
