import type { DocumentNode } from "graphql";
import { gql } from "graphql-tag";
import { CORE_SDL } from "./schema-core.js";
import { SECURITY_SDL } from "./schema-security.js";

/**
 * The renown-orgs SDL: the A1 core, then each later phase's `extend type`
 * block. No argument has a default value: signed messages hash the
 * arguments as the client sent them.
 */
export const schema: DocumentNode = gql([CORE_SDL, SECURITY_SDL].join("\n"));
