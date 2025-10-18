import { Subgraph } from "@powerhousedao/reactor-api";
import type { DocumentNode } from "graphql";
import { schema } from "./schema.js";
import { getResolvers } from "./resolvers.js";
import { type RenownUserProcessor } from "../../processors/renown-user/index.js";

export class RenownUserSubgraph extends Subgraph {
  name = "renown-user";
  typeDefs: DocumentNode = schema;
  resolvers = getResolvers(this);
  additionalContextFields = {};
  processor?: RenownUserProcessor;

  async onSetup() {
    // Find and store reference to the processor
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const processorStore = (this.reactor as any).processorStore;
    if (processorStore) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const processors = processorStore.getProcessors();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
      this.processor = processors.find(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
        (p: any) => p.constructor.name === "RenownUserProcessor",
      ) as RenownUserProcessor;
    }
  }

  async onDisconnect() {}
}
