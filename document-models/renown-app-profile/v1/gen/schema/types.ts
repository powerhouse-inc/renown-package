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

export type AddMetricInput = {
  aggregation: RenownMetricAggregation;
  /** At most 200 characters; empty means none */
  description?: InputMaybe<Scalars["String"]["input"]>;
  id: Scalars["OID"]["input"];
  /** ^[A-Za-z][A-Za-z0-9_.:-]{0,63}$, unique per app */
  key: Scalars["String"]["input"];
  /** 1-40 characters after trimming */
  label: Scalars["String"]["input"];
  public: Scalars["Boolean"]["input"];
  /** At most 16 characters; empty means none */
  unit?: InputMaybe<Scalars["String"]["input"]>;
};

export type RemoveLinkInput = {
  id: Scalars["OID"]["input"];
};

export type RemoveMetricInput = {
  id: Scalars["OID"]["input"];
};

export type RenownAppLink = {
  id: Scalars["OID"]["output"];
  label: Scalars["String"]["output"];
  url: Scalars["URL"]["output"];
};

export type RenownAppMetric = {
  aggregation: RenownMetricAggregation;
  /** At most 200 characters */
  description: Maybe<Scalars["String"]["output"]>;
  id: Scalars["OID"]["output"];
  /** The metric name the app reports: ^[A-Za-z][A-Za-z0-9_.:-]{0,63}$ */
  key: Scalars["String"]["output"];
  /** 1-40 characters */
  label: Scalars["String"]["output"];
  /** Shown on the app page and on user profiles */
  public: Scalars["Boolean"]["output"];
  /** At most 16 characters, e.g. notes */
  unit: Maybe<Scalars["String"]["output"]>;
};

export type RenownAppProfileState = {
  appDid: Maybe<Scalars["String"]["output"]>;
  /** At most 40 characters */
  category: Maybe<Scalars["String"]["output"]>;
  /** Uploaded 3:1 cover image */
  coverRef: Maybe<Scalars["AttachmentRef"]["output"]>;
  /** Markdown subset, at most 2000 characters; rendered sanitized */
  description: Maybe<Scalars["String"]["output"]>;
  /** At most 8 links, in display order */
  links: Array<RenownAppLink>;
  /** Legacy logo: an https URL or a raster data URL; logoRef wins when set */
  logo: Maybe<Scalars["String"]["output"]>;
  /** Uploaded square logo */
  logoRef: Maybe<Scalars["AttachmentRef"]["output"]>;
  /** Publisher-defined metrics, at most 16, in display order */
  metrics: Array<RenownAppMetric>;
  name: Maybe<Scalars["String"]["output"]>;
  publisherDid: Maybe<Scalars["String"]["output"]>;
  tagline: Maybe<Scalars["String"]["output"]>;
  website: Maybe<Scalars["String"]["output"]>;
};

export type RenownMetricAggregation = "AVG" | "COUNT_USERS" | "MAX" | "SUM";

export type ReorderLinksInput = {
  linkIds: Array<Scalars["OID"]["input"]>;
};

export type ReorderMetricsInput = {
  metricIds: Array<Scalars["OID"]["input"]>;
};

export type SetAppDidInput = {
  appDid: Scalars["String"]["input"];
};

export type SetProfileInput = {
  /** At most 40 characters; empty clears */
  category?: InputMaybe<Scalars["String"]["input"]>;
  /** attachment://v1:<sha256>; empty clears */
  coverRef?: InputMaybe<Scalars["String"]["input"]>;
  /** Markdown subset, at most 2000 characters; empty clears */
  description?: InputMaybe<Scalars["String"]["input"]>;
  logo?: InputMaybe<Scalars["String"]["input"]>;
  /** attachment://v1:<sha256>; empty clears */
  logoRef?: InputMaybe<Scalars["String"]["input"]>;
  name?: InputMaybe<Scalars["String"]["input"]>;
  tagline?: InputMaybe<Scalars["String"]["input"]>;
  website?: InputMaybe<Scalars["String"]["input"]>;
};

export type SetPublisherDidInput = {
  publisherDid: Scalars["String"]["input"];
};

export type UpdateLinkInput = {
  id: Scalars["OID"]["input"];
  label?: InputMaybe<Scalars["String"]["input"]>;
  url?: InputMaybe<Scalars["URL"]["input"]>;
};

export type UpdateMetricInput = {
  aggregation?: InputMaybe<RenownMetricAggregation>;
  description?: InputMaybe<Scalars["String"]["input"]>;
  id: Scalars["OID"]["input"];
  key?: InputMaybe<Scalars["String"]["input"]>;
  label?: InputMaybe<Scalars["String"]["input"]>;
  public?: InputMaybe<Scalars["Boolean"]["input"]>;
  unit?: InputMaybe<Scalars["String"]["input"]>;
};
