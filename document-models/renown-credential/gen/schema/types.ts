export type Maybe<T> = T | null;
export type InputMaybe<T> = T | null | undefined;
export type Exact<T extends { [key: string]: unknown }> = {
  [K in keyof T]: T[K];
};
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & {
  [SubKey in K]?: Maybe<T[SubKey]>;
};
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & {
  [SubKey in K]: Maybe<T[SubKey]>;
};
export type MakeEmpty<
  T extends { [key: string]: unknown },
  K extends keyof T,
> = { [_ in K]?: never };
export type Incremental<T> =
  | T
  | {
      [P in keyof T]?: P extends " $fragmentName" | "__typename" ? T[P] : never;
    };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string };
  String: { input: string; output: string };
  Boolean: { input: boolean; output: boolean };
  Int: { input: number; output: number };
  Float: { input: number; output: number };
  Amount: {
    input: { unit?: string; value?: number };
    output: { unit?: string; value?: number };
  };
  Amount_Crypto: {
    input: { unit: string; value: string };
    output: { unit: string; value: string };
  };
  Amount_Currency: {
    input: { unit: string; value: string };
    output: { unit: string; value: string };
  };
  Amount_Fiat: {
    input: { unit: string; value: number };
    output: { unit: string; value: number };
  };
  Amount_Money: { input: number; output: number };
  Amount_Percentage: { input: number; output: number };
  Amount_Tokens: { input: number; output: number };
  Currency: { input: string; output: string };
  Date: { input: string; output: string };
  DateTime: { input: string; output: string };
  EmailAddress: { input: string; output: string };
  EthereumAddress: { input: string; output: string };
  OID: { input: string; output: string };
  OLabel: { input: string; output: string };
  PHID: { input: string; output: string };
  URL: { input: string; output: string };
  Upload: { input: File; output: File };
};

export type CredentialStatus = {
  id: Scalars["String"]["output"];
  statusListCredential: Scalars["String"]["output"];
  statusListIndex: Scalars["String"]["output"];
  statusPurpose: Scalars["String"]["output"];
  type: Scalars["String"]["output"];
};

export type InitInput = {
  jwt: Scalars["String"]["input"];
};

export type RenownCredentialState = {
  /** W3C VC Common Fields - extracted for convenience, may be null for non-standard VCs */
  context: Maybe<Array<Scalars["String"]["output"]>>;
  credentialStatus: Maybe<CredentialStatus>;
  credentialSubject: Maybe<Scalars["String"]["output"]>;
  /** W3C VC Optional Fields */
  expirationDate: Maybe<Scalars["DateTime"]["output"]>;
  id: Maybe<Scalars["String"]["output"]>;
  issuanceDate: Maybe<Scalars["DateTime"]["output"]>;
  issuer: Maybe<Scalars["String"]["output"]>;
  /** JWT Representation */
  jwt: Maybe<Scalars["String"]["output"]>;
  jwtPayload: Maybe<Scalars["String"]["output"]>;
  jwtVerificationError: Maybe<Scalars["String"]["output"]>;
  jwtVerified: Maybe<Scalars["Boolean"]["output"]>;
  revocationReason: Maybe<Scalars["String"]["output"]>;
  /** Revocation tracking */
  revoked: Maybe<Scalars["Boolean"]["output"]>;
  revokedAt: Maybe<Scalars["DateTime"]["output"]>;
  type: Maybe<Array<Scalars["String"]["output"]>>;
  /** Complete VC Payload - stores the full verifiable credential object for maximum flexibility */
  vcPayload: Maybe<Scalars["String"]["output"]>;
};

export type RevokeInput = {
  reason?: InputMaybe<Scalars["String"]["input"]>;
  revokedAt: Scalars["DateTime"]["input"];
};

export type SetCredentialStatusInput = {
  statusId: Scalars["String"]["input"];
  statusListCredential: Scalars["String"]["input"];
  statusListIndex: Scalars["String"]["input"];
  statusPurpose: Scalars["String"]["input"];
  statusType: Scalars["String"]["input"];
};

export type SetJwtInput = {
  jwt: Scalars["String"]["input"];
};

export type UpdateCredentialSubjectInput = {
  credentialSubject: Scalars["String"]["input"];
};
