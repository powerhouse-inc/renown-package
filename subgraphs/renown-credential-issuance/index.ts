import { BaseSubgraph } from "@powerhousedao/reactor-api";
import type { DocumentNode } from "graphql";
import { schema } from "./schema.js";
import { getResolvers } from "./resolvers.js";

export class RenownCredentialSubgraph extends BaseSubgraph {
  // Must NOT match a document model's generated subgraph name (e.g.
  // "renown-credential") or the reactor shadows this custom subgraph.
  name = "renown-credential-issuance";
  typeDefs: DocumentNode = schema;
  resolvers = getResolvers(this);
  additionalContextFields = {};
  async onSetup() {}
  async onDisconnect() {}
}
