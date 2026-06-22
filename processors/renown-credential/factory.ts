import type {
  IProcessorHostModule,
  ProcessorApp,
  ProcessorFactoryBuilder,
  ProcessorFilter,
} from "@powerhousedao/reactor-browser";
import type { PHDocumentHeader } from "document-model";
import { RenownCredential, type IReactor } from "./processor.js";

// The host module optionally exposes a reactor so the processor can delete a
// document when its credential is revoked (preserved from the original impl).
interface IProcessorHostModuleWithReactor extends IProcessorHostModule {
  reactor?: IReactor;
}

export const renownCredentialFactoryBuilder: ProcessorFactoryBuilder =
  (module: IProcessorHostModule) =>
  async (driveHeader: PHDocumentHeader, processorApp?: ProcessorApp) => {
    // Create a namespace for the processor and the provided drive id
    const namespace = RenownCredential.getNamespace(driveHeader.id);

    // Create a namespaced db for the processor
    const store =
      await module.relationalDb.createNamespace<RenownCredential>(namespace);

    // Create a filter for the processor
    const filter: ProcessorFilter = {
      branch: ["main"],
      documentId: ["*"],
      documentType: ["powerhouse/renown-credential"],
      scope: ["global"],
    };

    // Create the processor (wire the optional reactor for revoke-time deletion)
    const reactor = (module as IProcessorHostModuleWithReactor).reactor;
    const processor = new RenownCredential(namespace, filter, store, reactor);
    return [
      {
        processor,
        filter,
      },
    ];
  };
