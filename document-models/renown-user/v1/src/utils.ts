/** Most links one profile may hold. */
export const MAX_LINKS = 8;
export const MAX_DISPLAY_NAME_LENGTH = 64;
export const MAX_BIO_LENGTH = 280;
export const MAX_LINK_LABEL_LENGTH = 40;
export const MAX_LINK_URL_LENGTH = 2048;

/** 3-30 chars, lowercase letters/digits/hyphens, no leading or trailing hyphen. */
export const HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;
const AVATAR_REF_RE = /^attachment:\/\/v1:[0-9a-f]{64}$/;

export function isValidHandle(value: string): boolean {
  return HANDLE_RE.test(value);
}

export function isValidAvatarRef(value: string): boolean {
  return AVATAR_REF_RE.test(value);
}

/** A display name is non-blank, carries no surrounding whitespace and fits 64 chars. */
export function isValidDisplayName(value: string): boolean {
  return value.length > 0 && value === value.trim() && value.length <= MAX_DISPLAY_NAME_LENGTH;
}

export function isValidLinkLabel(value: string): boolean {
  return value.length > 0 && value === value.trim() && value.length <= MAX_LINK_LABEL_LENGTH;
}

/** Only http(s) links are stored, so a profile never renders a javascript: or data: href. */
export function isValidLinkUrl(value: string): boolean {
  if (value.length > MAX_LINK_URL_LENGTH) return false;
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}
