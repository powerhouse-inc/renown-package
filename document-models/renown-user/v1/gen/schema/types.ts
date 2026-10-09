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

export type AddLinkInput = {
  id: Scalars["OID"]["input"];
  /** 1-40 characters after trimming */
  label: Scalars["String"]["input"];
  /** http(s) URL, at most 2048 characters */
  url: Scalars["URL"]["input"];
};

export type RemoveLinkInput = {
  id: Scalars["OID"]["input"];
};

export type RenownUserLink = {
  id: Scalars["OID"]["output"];
  label: Scalars["String"]["output"];
  url: Scalars["URL"]["output"];
};

export type RenownUserState = {
  /** Uploaded avatar; userImage stays the external (ENS) image URL */
  avatar: Maybe<Scalars["AttachmentRef"]["output"]>;
  /** Short bio, at most 280 characters */
  bio: Maybe<Scalars["String"]["output"]>;
  /** Display name, 1-64 characters */
  displayName: Maybe<Scalars["String"]["output"]>;
  ethAddress: Maybe<Scalars["EthereumAddress"]["output"]>;
  /** Unique handle; uniqueness is enforced by the write path, not the reducer */
  handle: Maybe<Scalars["String"]["output"]>;
  /** Profile links, at most 8, in display order */
  links: Array<RenownUserLink>;
  userImage: Maybe<Scalars["String"]["output"]>;
  /** Add your global state fields here */
  username: Maybe<Scalars["String"]["output"]>;
};

export type ReorderLinksInput = {
  linkIds: Array<Scalars["OID"]["input"]>;
};

export type SetAvatarInput = {
  /** attachment://v1:<sha256>; null clears */
  avatar?: InputMaybe<Scalars["AttachmentRef"]["input"]>;
};

export type SetBioInput = {
  /** At most 280 characters; null or empty clears */
  bio?: InputMaybe<Scalars["String"]["input"]>;
};

export type SetDisplayNameInput = {
  /** 1-64 characters after trimming; null clears */
  displayName?: InputMaybe<Scalars["String"]["input"]>;
};

export type SetEthAddressInput = {
  /** Add your inputs here */
  ethAddress: Scalars["EthereumAddress"]["input"];
};

export type SetHandleInput = {
  /** ^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$; null clears */
  handle?: InputMaybe<Scalars["String"]["input"]>;
};

export type SetUserImageInput = {
  /** Add your inputs here */
  userImage: Scalars["String"]["input"];
};

export type SetUsernameInput = {
  /** Add your inputs here */
  username: Scalars["String"]["input"];
};

export type UpdateLinkInput = {
  id: Scalars["OID"]["input"];
  label?: InputMaybe<Scalars["String"]["input"]>;
  url?: InputMaybe<Scalars["URL"]["input"]>;
};
