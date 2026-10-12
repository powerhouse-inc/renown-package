/** Organisation validators and limits, shared by the reducers and the renown-orgs subgraph. */

/** 3-30 characters, lowercase letters, digits and inner hyphens: the same rule as user handles. */
export const ORG_HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;
export const MAX_ORG_NAME_LENGTH = 64;
export const MAX_ORG_BIO_LENGTH = 280;
export const MAX_ORG_LINKS = 8;
export const MAX_ORG_LINK_LABEL_LENGTH = 40;
export const MAX_ORG_URL_LENGTH = 2048;
export const MAX_ACTIVE_MEMBERS = 500;
export const MAX_TEAMS = 50;
export const MAX_SCOPE_APPS = 200;
export const MAX_TEAM_NAME_LENGTH = 64;

const TEAM_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const ORG_AVATAR_RE = /^attachment:\/\/v1:[0-9a-f]{64}$/;
const ORG_APP_DID_RE = /^did:key:z[1-9A-HJ-NP-Za-km-z]{32,128}$/;
// Lowercase labels of 1-63 characters, at least two labels, a top-level label
// starting with a letter (so an IP address never passes), 4-253 characters.
const ORG_DOMAIN_RE =
  /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])$/;

function trimmedWithin(value: string, max: number): boolean {
  return value.length > 0 && value.length <= max && value === value.trim();
}

function isHttpUrl(value: string): boolean {
  if (value.length > MAX_ORG_URL_LENGTH) return false;
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

export function isOrgHandle(value: string): boolean {
  return ORG_HANDLE_RE.test(value);
}

export function isOrgName(value: string): boolean {
  return trimmedWithin(value, MAX_ORG_NAME_LENGTH);
}

export function isOrgWebsite(value: string): boolean {
  return isHttpUrl(value);
}

export function isOrgAvatarRef(value: string): boolean {
  return ORG_AVATAR_RE.test(value);
}

export function isOrgLinkLabel(value: string): boolean {
  return trimmedWithin(value, MAX_ORG_LINK_LABEL_LENGTH);
}

export function isOrgLinkUrl(value: string): boolean {
  return isHttpUrl(value);
}

export function isOrgAppDid(value: string): boolean {
  return ORG_APP_DID_RE.test(value);
}

export function isOrgDomain(value: string): boolean {
  return ORG_DOMAIN_RE.test(value);
}

export function isTeamSlug(value: string): boolean {
  return TEAM_SLUG_RE.test(value);
}

export function isTeamName(value: string): boolean {
  return trimmedWithin(value, MAX_TEAM_NAME_LENGTH);
}
