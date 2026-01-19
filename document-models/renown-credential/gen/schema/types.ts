export type Maybe<T> = T | null | undefined;
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
  Address: { input: `${string}:0x${string}`; output: `${string}:0x${string}` };
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
  Attachment: { input: string; output: string };
  Currency: { input: string; output: string };
  Date: { input: string; output: string };
  DateTime: { input: string; output: string };
  EmailAddress: { input: string; output: string };
  EthereumAddress: { input: string; output: string };
  OID: { input: string; output: string };
  OLabel: { input: string; output: string };
  PHID: { input: string; output: string };
  URL: { input: string; output: string };
  Unknown: { input: unknown; output: unknown };
  Upload: { input: File; output: File };
};

export type CredentialSchema = {
  id: Scalars["String"]["output"];
  type: Scalars["String"]["output"];
};

export type CredentialSchemaInput = {
  id: Scalars["String"]["input"];
  type: Scalars["String"]["input"];
};

export type CredentialStatus = {
  id: Scalars["String"]["output"];
  type: Scalars["String"]["output"];
};

export type CredentialStatusInput = {
  id: Scalars["String"]["input"];
  type: Scalars["String"]["input"];
};

export type CredentialSubject = {
  app: Scalars["String"]["output"];
  id: Maybe<Scalars["String"]["output"]>;
};

export type CredentialSubjectInput = {
  app: Scalars["String"]["input"];
  id?: InputMaybe<Scalars["String"]["input"]>;
};

export type Eip712 = {
  domain: Eip712Domain;
  primaryType: Scalars["String"]["output"];
};

export type Eip712Domain = {
  chainId: Scalars["Int"]["output"];
  version: Scalars["String"]["output"];
};

export type Eip712DomainInput = {
  chainId: Scalars["Int"]["input"];
  version: Scalars["String"]["input"];
};

export type Eip712Input = {
  domain: Eip712DomainInput;
  primaryType: Scalars["String"]["input"];
};

export type InitInput = {
  context: Array<Scalars["String"]["input"]>;
  credentialSchema: CredentialSchemaInput;
  credentialStatus?: InputMaybe<CredentialStatusInput>;
  credentialSubject: CredentialSubjectInput;
  expirationDate?: InputMaybe<Scalars["DateTime"]["input"]>;
  id: Scalars["String"]["input"];
  issuanceDate: Scalars["DateTime"]["input"];
  issuer: IssuerInput;
  proof: ProofInput;
  type: Array<Scalars["String"]["input"]>;
};

export type Issuer = {
  ethereumAddress: Scalars["EthereumAddress"]["output"];
  id: Scalars["String"]["output"];
};

export type IssuerInput = {
  ethereumAddress: Scalars["EthereumAddress"]["input"];
  id: Scalars["String"]["input"];
};

export type Proof = {
  created: Scalars["DateTime"]["output"];
  eip712: Eip712;
  ethereumAddress: Scalars["EthereumAddress"]["output"];
  proofPurpose: Scalars["String"]["output"];
  proofValue: Scalars["String"]["output"];
  type: Scalars["String"]["output"];
  verificationMethod: Scalars["String"]["output"];
};

export type ProofInput = {
  created: Scalars["DateTime"]["input"];
  eip712: Eip712Input;
  ethereumAddress: Scalars["EthereumAddress"]["input"];
  proofPurpose: Scalars["String"]["input"];
  proofValue: Scalars["String"]["input"];
  type: Scalars["String"]["input"];
  verificationMethod: Scalars["String"]["input"];
};

export type RenownCredentialState = {
  /** W3C VC Fields - EIP-712 Signed Verifiable Credential */
  context: Array<Scalars["String"]["output"]>;
  credentialSchema: CredentialSchema;
  credentialStatus: Maybe<CredentialStatus>;
  credentialSubject: CredentialSubject;
  expirationDate: Maybe<Scalars["DateTime"]["output"]>;
  id: Scalars["String"]["output"];
  issuanceDate: Scalars["DateTime"]["output"];
  issuer: Issuer;
  proof: Proof;
  revocationReason: Maybe<Scalars["String"]["output"]>;
  /** Revocation tracking */
  revoked: Scalars["Boolean"]["output"];
  revokedAt: Maybe<Scalars["DateTime"]["output"]>;
  type: Array<Scalars["String"]["output"]>;
};

export type RevokeInput = {
  reason?: InputMaybe<Scalars["String"]["input"]>;
  revokedAt: Scalars["DateTime"]["input"];
};
