import { type Action } from "document-model";
import type { InitInput, RevokeInput } from "../types.js";

export type InitAction = Action & { type: "INIT"; input: InitInput };
export type RevokeAction = Action & { type: "REVOKE"; input: RevokeInput };

export type RenownCredentialManagerAction = InitAction | RevokeAction;
