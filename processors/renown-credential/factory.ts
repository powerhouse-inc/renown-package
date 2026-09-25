import type {
  IProcessorHostModule,
  ProcessorFactoryBuilder,
  ProcessorFilter,
} from "@powerhousedao/reactor-browser";
import { RenownCredentialProcessor } from "./processor.js";

// One namespace for all drives: the renown read model is global.
export const renownCredentialFactoryBuilder: ProcessorFactoryBuilder =
  (module: IProcessorHostModule) => async () => {
    const namespace =
      RenownCredentialProcessor.getNamespace("renown-credential");
    const store =
      await module.relationalDb.createNamespace<RenownCredentialProcessor>(
        namespace,
      );

    const filter: ProcessorFilter = {
      branch: ["main"],
      documentId: ["*"],
      documentType: ["powerhouse/renown-credential"],
      scope: ["global"],
    };

    const processor = new RenownCredentialProcessor(
      namespace,
      filter,
      store,
      module.client,
    );
    await processor.initAndUpgrade();
    return [{ processor, filter }];
  };
