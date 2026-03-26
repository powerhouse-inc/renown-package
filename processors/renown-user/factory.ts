import type {
  ProcessorRecord,
  IProcessorHostModule,
  ProcessorFilter,
} from "@powerhousedao/reactor-browser";
import type { PHDocumentHeader } from "document-model";
import { RenownUserProcessor } from "./index.js";
import { up } from "./migrations.js";

export const renownUserProcessorFactory =
  (module: IProcessorHostModule) =>
  async (driveHeader: PHDocumentHeader): Promise<ProcessorRecord[]> => {
    const namespace = RenownUserProcessor.getNamespace("renown-user");
    const store =
      await module.relationalDb.createNamespace<RenownUserProcessor>(namespace);

    await up(store);

    const filter: ProcessorFilter = {
      branch: ["main"],
      documentId: ["*"],
      documentType: ["powerhouse/renown-user"],
      scope: ["global"],
    };

    const processor = new RenownUserProcessor(namespace, filter, store);
    return [{ processor, filter }];
  };
