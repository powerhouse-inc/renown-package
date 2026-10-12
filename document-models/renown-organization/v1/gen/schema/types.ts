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

export type AddDomainInput = {
  domain: Scalars["String"]["input"];
  id: Scalars["OID"]["input"];
};

export type AddOrgAppInput = {
  addedAt: Scalars["DateTime"]["input"];
  appDid: Scalars["String"]["input"];
};

export type AddTeamInput = {
  appDids: Array<Scalars["String"]["input"]>;
  id: Scalars["OID"]["input"];
  name: Scalars["String"]["input"];
  slug: Scalars["String"]["input"];
};

export type ArchiveOrgInput = {
  archivedAt: Scalars["DateTime"]["input"];
};

export type InitOrganizationInput = {
  createdBy: Scalars["EthereumAddress"]["input"];
  handle: Scalars["String"]["input"];
  name: Scalars["String"]["input"];
};

export type InviteMemberInput = {
  address: Scalars["EthereumAddress"]["input"];
  id: Scalars["OID"]["input"];
  invitedAt: Scalars["DateTime"]["input"];
  role: RenownOrgRole;
};

export type RemoveDomainInput = {
  id: Scalars["OID"]["input"];
};

export type RemoveOrgAppInput = {
  appDid: Scalars["String"]["input"];
};

export type RemoveTeamInput = {
  id: Scalars["OID"]["input"];
};

export type RenownOrgApp = {
  addedAt: Scalars["DateTime"]["output"];
  appDid: Scalars["String"]["output"];
  frozen: Scalars["Boolean"]["output"];
};

export type RenownOrgAppScope = {
  all: Scalars["Boolean"]["output"];
  appDids: Array<Scalars["String"]["output"]>;
};

export type RenownOrgDomain = {
  domain: Scalars["String"]["output"];
  id: Scalars["OID"]["output"];
  status: RenownOrgDomainStatus;
  verifiedAt: Maybe<Scalars["DateTime"]["output"]>;
};

export type RenownOrgDomainStatus = "LAPSED" | "PENDING" | "VERIFIED";

export type RenownOrgLink = {
  id: Scalars["OID"]["output"];
  label: Scalars["String"]["output"];
  url: Scalars["String"]["output"];
};

export type RenownOrgMember = {
  /** Lowercase */
  address: Scalars["EthereumAddress"]["output"];
  appScope: RenownOrgAppScope;
  hidden: Scalars["Boolean"]["output"];
  id: Scalars["OID"]["output"];
  joinedAt: Maybe<Scalars["DateTime"]["output"]>;
  role: RenownOrgRole;
  status: RenownOrgMemberStatus;
  updatedAt: Scalars["DateTime"]["output"];
};

export type RenownOrgMemberStatus =
  | "ACTIVE"
  | "DECLINED"
  | "INVITED"
  | "LEFT"
  | "REMOVED"
  | "REVOKED";

export type RenownOrgRole = "ADMIN" | "MEMBER" | "OWNER" | "PUBLISHER";

export type RenownOrgTeam = {
  appDids: Array<Scalars["String"]["output"]>;
  id: Scalars["OID"]["output"];
  memberIds: Array<Scalars["OID"]["output"]>;
  name: Scalars["String"]["output"];
  slug: Scalars["String"]["output"];
};

export type RenownOrganizationState = {
  apps: Array<RenownOrgApp>;
  archived: Scalars["Boolean"]["output"];
  /** attachment://v1:<sha256> */
  avatar: Maybe<Scalars["String"]["output"]>;
  /** At most 280 characters */
  bio: Maybe<Scalars["String"]["output"]>;
  /** Lowercase address of the creator; set once by INIT_ORGANIZATION */
  createdBy: Maybe<Scalars["EthereumAddress"]["output"]>;
  domains: Array<RenownOrgDomain>;
  /** Lowercase; unique across users and organizations (enforced by the write path) */
  handle: Maybe<Scalars["String"]["output"]>;
  /** At most 8, in display order */
  links: Array<RenownOrgLink>;
  /** Opted in to the organization directory */
  listed: Scalars["Boolean"]["output"];
  /** Every membership record ever created (rows are never removed) */
  members: Array<RenownOrgMember>;
  /** Active, non-hidden members are shown publicly */
  membersPublic: Scalars["Boolean"]["output"];
  /** 1-64 characters */
  name: Maybe<Scalars["String"]["output"]>;
  /** Delegation credential ids suspended by the organization */
  suspendedCredentialIds: Array<Scalars["String"]["output"]>;
  takenDown: Scalars["Boolean"]["output"];
  /** At most 50 flat teams */
  teams: Array<RenownOrgTeam>;
  /** An http(s) URL */
  website: Maybe<Scalars["String"]["output"]>;
};

export type SetAppFrozenInput = {
  appDid: Scalars["String"]["input"];
  frozen: Scalars["Boolean"]["input"];
};

export type SetDomainStatusInput = {
  id: Scalars["OID"]["input"];
  status: RenownOrgDomainStatus;
  verifiedAt?: InputMaybe<Scalars["DateTime"]["input"]>;
};

export type SetMemberAppScopeInput = {
  all: Scalars["Boolean"]["input"];
  appDids: Array<Scalars["String"]["input"]>;
  at: Scalars["DateTime"]["input"];
  id: Scalars["OID"]["input"];
};

export type SetMemberHiddenInput = {
  at: Scalars["DateTime"]["input"];
  hidden: Scalars["Boolean"]["input"];
  id: Scalars["OID"]["input"];
};

export type SetMemberRoleInput = {
  at: Scalars["DateTime"]["input"];
  id: Scalars["OID"]["input"];
  role: RenownOrgRole;
};

export type SetMemberStatusInput = {
  at: Scalars["DateTime"]["input"];
  id: Scalars["OID"]["input"];
  status: RenownOrgMemberStatus;
};

export type SetMembersPublicInput = {
  membersPublic: Scalars["Boolean"]["input"];
};

export type SetOrgHandleInput = {
  handle: Scalars["String"]["input"];
};

export type SetOrgListedInput = {
  listed: Scalars["Boolean"]["input"];
};

export type SetOrgProfileInput = {
  avatar?: InputMaybe<Scalars["String"]["input"]>;
  bio?: InputMaybe<Scalars["String"]["input"]>;
  links?: InputMaybe<Array<SetOrgProfileLinkInput>>;
  name?: InputMaybe<Scalars["String"]["input"]>;
  website?: InputMaybe<Scalars["String"]["input"]>;
};

export type SetOrgProfileLinkInput = {
  id: Scalars["OID"]["input"];
  label: Scalars["String"]["input"];
  url: Scalars["String"]["input"];
};

export type SetTakenDownInput = {
  takenDown: Scalars["Boolean"]["input"];
};

export type SetTeamMembersInput = {
  id: Scalars["OID"]["input"];
  memberIds: Array<Scalars["OID"]["input"]>;
};

export type SuspendCredentialsInput = {
  credentialIds: Array<Scalars["String"]["input"]>;
};

export type UnsuspendCredentialInput = {
  credentialId: Scalars["String"]["input"];
};

export type UpdateTeamInput = {
  appDids?: InputMaybe<Array<Scalars["String"]["input"]>>;
  id: Scalars["OID"]["input"];
  name?: InputMaybe<Scalars["String"]["input"]>;
  slug?: InputMaybe<Scalars["String"]["input"]>;
};
