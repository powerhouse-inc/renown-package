import type {
  ProcessorRecord,
  IProcessorHostModule,
} from "@powerhousedao/reactor-browser";
import type { PHDocumentHeader } from "document-model";

import { renownUserProcessorFactory } from "./renown-user/factory.js";
import {
  renownCredentialProcessorFactory,
  type IProcessorHostModuleWithReactor,
} from "./renown-credential/factory.js";

export const processorFactory = async (
  module: IProcessorHostModule | IProcessorHostModuleWithReactor,
) => {
  const factories: Array<
    (driveHeader: PHDocumentHeader) => Promise<ProcessorRecord[]>
  > = [];

  factories.push(renownUserProcessorFactory(module));
  factories.push(
    renownCredentialProcessorFactory(
      module as IProcessorHostModuleWithReactor,
    ),
  );

  return async (driveHeader: PHDocumentHeader): Promise<ProcessorRecord[]> => {
    const processors: ProcessorRecord[] = [];
    for (const factory of factories) {
      const factoryProcessors = await factory(driveHeader);
      processors.push(...factoryProcessors);
    }
    return processors;
  };
};
