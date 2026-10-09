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
  AttachmentRef: {
    input: `attachment://v${number}:${string}`;
    output: `attachment://v${number}:${string}`;
  };
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

export type AddAllowedSubjectInput = {
  subject: Scalars["String"]["input"];
};

export type AddRedirectUriInput = {
  uri: Scalars["URL"]["input"];
};

export type RemoveAllowedSubjectInput = {
  subject: Scalars["String"]["input"];
};

export type RemoveRedirectUriInput = {
  uri: Scalars["URL"]["input"];
};

export type RenownOidcClientState = {
  allowAnySubject: Scalars["Boolean"]["output"];
  allowedSubjects: Array<Scalars["String"]["output"]>;
  clientSecretHash: Maybe<Scalars["String"]["output"]>;
  name: Maybe<Scalars["String"]["output"]>;
  redirectUris: Array<Scalars["URL"]["output"]>;
  status: RenownOidcClientStatus;
};

export type RenownOidcClientStatus = "ACTIVE" | "DISABLED";

export type SetAllowAnySubjectInput = {
  allow: Scalars["Boolean"]["input"];
};

export type SetClientInfoInput = {
  name: Scalars["String"]["input"];
};

export type SetClientSecretHashInput = {
  hash?: InputMaybe<Scalars["String"]["input"]>;
};

export type SetStatusInput = {
  status: RenownOidcClientStatus;
};
