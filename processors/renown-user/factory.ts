import type {
  IProcessorHostModule,
  ProcessorFactoryBuilder,
  ProcessorFilter,
} from "@powerhousedao/reactor-browser";
import { RenownUserProcessor } from "./processor.js";

// One namespace for all drives: the renown read model is global.
export const renownUserFactoryBuilder: ProcessorFactoryBuilder =
  (module: IProcessorHostModule) => {
    // Uploads and public media URLs ride on this processor's host module: it
    // is where a package gets the attachment client and its HTTP scope.
    // Loaded lazily so the S3 client stays out of every bundle that only
    // needs the processor class (the subgraphs import it for its queries).
    if (module.http) {
      void import("../../media/register.js")
        .then(({ registerMedia }) => registerMedia(module))
        .catch((error: unknown) => {
          const reason = error instanceof Error ? error.message : "unknown error";
          console.error(`[renown-media] failed to start (${reason}); uploads and media disabled`);
        });
    }
    return async () => {
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
  };
