import type {
  IProcessorHostModule,
  ProcessorFactoryBuilder,
  ProcessorFilter,
} from "@powerhousedao/reactor-browser";
import { RenownUserProcessor } from "./processor.js";

// One namespace for all drives: the renown read model is global.
export const renownUserFactoryBuilder: ProcessorFactoryBuilder =
  (module: IProcessorHostModule) => async () => {
    const namespace = RenownUserProcessor.getNamespace("renown-user");
    const store =
      await module.relationalDb.createNamespace<RenownUserProcessor>(namespace);

    const filter: ProcessorFilter = {
      branch: ["main"],
      documentId: ["*"],
      documentType: ["powerhouse/renown-user"],
      scope: ["global"],
    };

    const processor = new RenownUserProcessor(namespace, filter, store);
    await processor.initAndUpgrade();
    return [{ processor, filter }];
  };
