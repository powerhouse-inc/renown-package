export interface OidcClient {
  id: string;
  name: string;
  redirectUris: string[];
  allowedSubjects: string[];
  allowAnySubject: boolean;
  clientSecretHash: string | null;
  status: "ACTIVE" | "DISABLED";
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
