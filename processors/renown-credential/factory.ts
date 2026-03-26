import type {
  ProcessorRecord,
  IProcessorHostModule,
  ProcessorFilter,
} from "@powerhousedao/reactor-browser";
import type { PHDocumentHeader } from "document-model";
import { RenownCredentialProcessor, type IReactor } from "./index.js";
import { up } from "./migrations.js";

export interface IProcessorHostModuleWithReactor extends IProcessorHostModule {
  reactor?: IReactor;
}

export const renownCredentialProcessorFactory =
  (module: IProcessorHostModuleWithReactor) =>
  async (driveHeader: PHDocumentHeader): Promise<ProcessorRecord[]> => {
    const namespace =
      RenownCredentialProcessor.getNamespace("renown-credential");
    const store =
      await module.relationalDb.createNamespace<RenownCredentialProcessor>(
        namespace,
      );

    await up(store);

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
      module.reactor,
    );
    return [{ processor, filter }];
  };
