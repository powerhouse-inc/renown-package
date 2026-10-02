const VERSION = "v1";
const IV_BYTES = 12;

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function fromBase64Url(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64url"));
}

function importAesKey(key: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    key as Uint8Array<ArrayBuffer>,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Seals `plaintext` with AES-256-GCM under `key`, binding it to `context`
 * (additional authenticated data, e.g. the identity's DID) so a sealed value
 * can't be moved to another row. Output: `v1.<iv>.<ciphertext+tag>` (base64url).
 */
export async function seal(
  key: Uint8Array,
  plaintext: string,
  context: string,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode(context),
    },
    await importAesKey(key),
    new TextEncoder().encode(plaintext),
  );
  return `${VERSION}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`;
}

/** Opens a value sealed by `seal`. Throws when the key, context or value is wrong. */
export async function open(
  key: Uint8Array,
  sealed: string,
  context: string,
): Promise<string> {
  const [version, iv, ciphertext, ...rest] = sealed.split(".");
  if (version !== VERSION || !iv || !ciphertext || rest.length > 0) {
    throw new Error("Malformed sealed value");
  }
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: fromBase64Url(iv) as Uint8Array<ArrayBuffer>,
      additionalData: new TextEncoder().encode(context),
    },
    await importAesKey(key),
    fromBase64Url(ciphertext) as Uint8Array<ArrayBuffer>,
  );
  return new TextDecoder().decode(plaintext);
}
