import { gql } from "graphql-tag";
import type { DocumentNode } from "graphql";
import { documentModel } from "../../document-models/renown-credential/v1/gen/document-model.js";

// Reuse the credential model's own input SDL, prefixed to match the reactor-
// generated `RenownCredential_*Input` types so they merge in the supergraph
// and stay in lockstep with the model.
const PREFIX = "RenownCredential_";
const globalSchema: unknown = documentModel.specifications.at(-1)?.state.global.schema;
const stateSchema = typeof globalSchema === "string" ? globalSchema : "";
const inputBlocks: string[] = stateSchema.match(/input\s+\w+\s*\{[\s\S]*?\}/g) ?? [];
const inputNames: string[] = inputBlocks.map((block) => /input\s+(\w+)/.exec(block)?.[1] ?? "");
const inputTypeDefs = inputNames.reduce(
  (sdl, name) => (name ? sdl.replace(new RegExp(`\\b${name}\\b`, "g"), PREFIX + name) : sdl),
  inputBlocks.join("\n\n"),
);

export const schema: DocumentNode = gql`
  ${inputTypeDefs}

  """
  Renown writes that authorize themselves. They are public (no host policy
  applies to them) and write through the in-process reactor client, so each
  one checks its caller: a signed credential, a login token for the right
  address, or a fresh personal_sign by that address.
  """
  type Mutation {
    """
    Stores an EIP-712 signed delegation credential after verifying its
    signature. Idempotent by credential id; returns the credential document id.
    username and userImage only apply when the issuer has no profile yet.
    userDocId is accepted for compatibility and ignored.
    """
    renown_issueCredential(
      input: RenownCredential_InitInput!
      username: String
      userImage: String
      userDocId: PHID
    ): String

    """
    Revokes a credential by its VC id. Authorized by a login token for the
    issuer address, or by the issuer's personal_sign of
    "Revoke Renown credential <credentialId> at <timestamp>".
    """
    renown_revokeCredential(credentialId: String!, signature: String, timestamp: String): Boolean

    """
    Creates or updates the profile of an address; returns its document id.
    Authorized by a login token for the address, or by its personal_sign of
    "Update Renown profile <address> <sha256(json)> at <timestamp>".
    """
    renown_upsertProfile(
      address: String!
      username: String
      userImage: String
      signature: String
      timestamp: String
    ): String
  }
`;
