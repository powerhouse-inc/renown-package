import { gql } from "graphql-tag";
import type { DocumentNode } from "graphql";
import { documentModel } from "../../document-models/renown-credential/gen/document-model.js";

// Reuse the credential model's own input SDL, prefixed to match the reactor-
// generated `RenownCredential_*Input` types so they merge in the supergraph.
const PREFIX = "RenownCredential_";
const globalSchema: unknown =
  documentModel.specifications.at(-1)?.state.global.schema;
const stateSchema = typeof globalSchema === "string" ? globalSchema : "";
const inputBlocks: string[] =
  stateSchema.match(/input\s+\w+\s*\{[\s\S]*?\}/g) ?? [];
const inputNames: string[] = inputBlocks.map(
  (block: string) => /input\s+(\w+)/.exec(block)?.[1] ?? "",
);
const inputTypeDefs = inputNames.reduce(
  (sdl, name) =>
    name ? sdl.replace(new RegExp(`\\b${name}\\b`, "g"), PREFIX + name) : sdl,
  inputBlocks.join("\n\n"),
);

export const schema: DocumentNode = gql`
  ${inputTypeDefs}

  """
  Public issuance endpoint for Renown delegation credentials.

  Writes directly through the reactor client so it works even when the
  switchboard runs with authorization enabled (the "chicken-and-egg" sign-in
  bootstrap). Because the endpoint is unauthenticated, the resolver
  cryptographically validates the EIP-712 signed credential before persisting.
  The RenownUser profile is written separately as an authenticated request.
  """
  type Mutation {
    renown_issueCredential(input: RenownCredential_InitInput!): String
  }
`;
