/** A client restricted to members of an organization with at least `minRole`. */
export interface OidcAllowedOrg {
  orgId: string;
  minRole: "OWNER" | "ADMIN" | "PUBLISHER" | "MEMBER";
}

/** One entry of the `orgs` claim (renown-orgs `orgClaimsFor`); defined once, in the SDK. */
export type { OrgClaim } from "../../../sdk/orgs.js";

export interface OidcClient {
  id: string;
  name: string;
  redirectUris: string[];
  allowedSubjects: string[];
  allowAnySubject: boolean;
  clientSecretHash: string | null;
  status: "ACTIVE" | "DISABLED";
  /** Members of these organizations may sign in too; absent means none. */
  allowedOrgs?: OidcAllowedOrg[];
}

export interface LoginRequest {
  id: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string | null;
  nonce: string | null;
  codeChallenge: string | null;
  siweNonce: string;
  expiresAt: Date;
}

export interface AuthCode {
  codeHash: string;
  clientId: string;
  redirectUri: string;
  sub: string;
  address: string;
  chainId: number;
  nonce: string | null;
  codeChallenge: string | null;
  scope: string;
  authTime: Date;
  expiresAt: Date;
  usedAt: Date | null;
}

export interface AccessToken {
  tokenHash: string;
  codeHash: string;
  clientId: string;
  sub: string;
  address: string;
  scope: string;
  expiresAt: Date;
  revoked: boolean;
}

export interface Profile {
  username: string | null;
  userImage: string | null;
}

export interface OidcConfig {
  issuer: string;
  loginUrl: string;
  registrationToken: string | null;
  driveId: string | null;
}
