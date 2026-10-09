const DID_PKH = /^did:pkh:eip155:[1-9][0-9]{0,19}:0x[0-9a-fA-F]{40}$/;
const DID_KEY = /^did:key:z[1-9A-HJ-NP-Za-km-z]{32,128}$/;
const DATA_IMAGE =
  /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const IMAGE_REF = /^attachment:\/\/v1:[0-9a-f]{64}$/;

/** Longest description (markdown source), in characters. */
export const MAX_DESCRIPTION_LENGTH = 2000;
export const MAX_CATEGORY_LENGTH = 40;
/** Most links one profile may hold. */
export const MAX_LINKS = 8;
export const MAX_LINK_LABEL_LENGTH = 40;
export const MAX_LINK_URL_LENGTH = 2048;

/** An uploaded image: attachment://v1:<sha256 hex>. */
export type AppImageRef = `attachment://v${number}:${string}`;

function protocolOf(value: string): string | null {
  try {
    return new URL(value).protocol;
  } catch {
    return null;
  }
}

export function isAppDid(value: string): boolean {
  return DID_KEY.test(value);
}

export function isPublisherDid(value: string): boolean {
  return DID_PKH.test(value);
}

export function isWebsite(value: string): boolean {
  const protocol = protocolOf(value);
  return protocol === "https:" || protocol === "http:";
}

export function isLogo(value: string): boolean {
  return DATA_IMAGE.test(value) || protocolOf(value) === "https:";
}

export function isAppImageRef(value: string): value is AppImageRef {
  return IMAGE_REF.test(value);
}

export function isValidLinkLabel(value: string): boolean {
  return value.length > 0 && value === value.trim() && value.length <= MAX_LINK_LABEL_LENGTH;
}

/** Only http(s) links are stored, so a profile never renders a javascript: or data: href. */
export function isValidLinkUrl(value: string): boolean {
  if (value.length > MAX_LINK_URL_LENGTH) return false;
  const protocol = protocolOf(value);
  return protocol === "https:" || protocol === "http:";
}
