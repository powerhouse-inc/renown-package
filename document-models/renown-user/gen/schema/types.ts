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

export type AddAuthorizationInput = {
  audience?: InputMaybe<Scalars["String"]["input"]>;
  createdAt: Scalars["DateTime"]["input"];
  id: Scalars["OID"]["input"];
  issuer?: InputMaybe<Scalars["String"]["input"]>;
  jwt: Scalars["String"]["input"];
  payload?: InputMaybe<Scalars["String"]["input"]>;
  subject?: InputMaybe<Scalars["String"]["input"]>;
};

export type Authorization = {
  audience: Maybe<Scalars["String"]["output"]>;
  createdAt: Maybe<Scalars["DateTime"]["output"]>;
  id: Scalars["OID"]["output"];
  issuer: Maybe<Scalars["String"]["output"]>;
  jwt: Scalars["String"]["output"];
  payload: Maybe<Scalars["String"]["output"]>;
  revoked: Maybe<Scalars["Boolean"]["output"]>;
  revokedAt: Maybe<Scalars["DateTime"]["output"]>;
  subject: Maybe<Scalars["String"]["output"]>;
};

export type RemoveAuthorizationInput = {
  id: Scalars["OID"]["input"];
};

export type RenownUserState = {
  authorizations: Array<Authorization>;
  ethAddress: Maybe<Scalars["EthereumAddress"]["output"]>;
  userImage: Maybe<Scalars["String"]["output"]>;
  /** Add your global state fields here */
  username: Maybe<Scalars["String"]["output"]>;
};

export type RevokeAuthorizationInput = {
  id: Scalars["OID"]["input"];
  revokedAt: Scalars["DateTime"]["input"];
};

export type SetEthAddressInput = {
  /** Add your inputs here */
  ethAddress: Scalars["EthereumAddress"]["input"];
};

export type SetUserImageInput = {
  /** Add your inputs here */
  userImage: Scalars["String"]["input"];
};

export type SetUsernameInput = {
  /** Add your inputs here */
  username: Scalars["String"]["input"];
};
