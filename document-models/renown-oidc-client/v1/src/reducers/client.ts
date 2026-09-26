import type { RenownOidcClientClientOperations } from "document-models/renown-oidc-client/v1";
import {
  EmptyName,
  InvalidRedirectUri,
  InvalidSecretHash,
  InvalidSubject,
} from "../../gen/client/error.js";
import { isValidRedirectUri, normalizeSubject } from "../utils.js";

export const renownOidcClientClientOperations: RenownOidcClientClientOperations =
  {
    setClientInfoOperation(state, action) {
      const name = action.input.name.trim();
      if (!name) {
        throw new EmptyName("Client name must not be empty");
      }
      state.name = name;
    },
    addRedirectUriOperation(state, action) {
      const { uri } = action.input;
      if (!isValidRedirectUri(uri)) {
        throw new InvalidRedirectUri(`Invalid redirect URI: ${uri}`);
      }
      if (!state.redirectUris.includes(uri)) {
        state.redirectUris.push(uri);
      }
    },
    removeRedirectUriOperation(state, action) {
      const { uri } = action.input;
      state.redirectUris = state.redirectUris.filter((u) => u !== uri);
    },
    addAllowedSubjectOperation(state, action) {
      let subject: string;
      try {
        subject = normalizeSubject(action.input.subject);
      } catch (error) {
        throw new InvalidSubject((error as Error).message);
      }
      if (!state.allowedSubjects.includes(subject)) {
        state.allowedSubjects.push(subject);
      }
    },
    removeAllowedSubjectOperation(state, action) {
      const subject = normalizeSubject(action.input.subject);
      state.allowedSubjects = state.allowedSubjects.filter(
        (s) => s !== subject,
      );
    },
    setAllowAnySubjectOperation(state, action) {
      state.allowAnySubject = action.input.allow;
    },
    setClientSecretHashOperation(state, action) {
      const hash = action.input.hash ?? null;
      if (hash !== null && !/^sha256:[0-9a-f]{64}$/.test(hash)) {
        throw new InvalidSecretHash(`Invalid client secret hash: ${hash}`);
      }
      state.clientSecretHash = hash;
    },
    setStatusOperation(state, action) {
      state.status = action.input.status;
    },
  };
