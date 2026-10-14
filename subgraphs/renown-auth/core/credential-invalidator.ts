/**
 * The host's credential cache, as handed to every subgraph by a reactor-api
 * newer than 6.2.3 (`this.credentials`). Older hosts do not provide it.
 */
export interface CredentialInvalidator {
  invalidateCredential(address: string, chainId?: number, appDid?: string): void | Promise<void>;
}

export function isCredentialInvalidator(value: unknown): value is CredentialInvalidator {
  return (
    typeof value === "object" &&
    value !== null &&
    "invalidateCredential" in value &&
    typeof value.invalidateCredential === "function"
  );
}

/** The invalidator a subgraph instance carries, if its host provides one. */
export function credentialInvalidatorOf(subgraph: object): CredentialInvalidator | undefined {
  if (!("credentials" in subgraph)) return undefined;
  const { credentials } = subgraph;
  return isCredentialInvalidator(credentials) ? credentials : undefined;
}
