/* eslint-disable @typescript-eslint/no-empty-object-type */
/* eslint-disable @typescript-eslint/no-unused-vars */
import * as z from "zod";
import type {
  AddDomainInput,
  AddOrgAppInput,
  AddTeamInput,
  ArchiveOrgInput,
  InitOrganizationInput,
  InviteMemberInput,
  RemoveDomainInput,
  RemoveOrgAppInput,
  RemoveTeamInput,
  RenownOrgApp,
  RenownOrgAppScope,
  RenownOrgDomain,
  RenownOrgDomainStatus,
  RenownOrgLink,
  RenownOrgMember,
  RenownOrgMemberStatus,
  RenownOrgRole,
  RenownOrgTeam,
  RenownOrganizationState,
  SetAppFrozenInput,
  SetDomainStatusInput,
  SetMemberAppScopeInput,
  SetMemberHiddenInput,
  SetMemberRoleInput,
  SetMemberStatusInput,
  SetMembersPublicInput,
  SetOrgHandleInput,
  SetOrgListedInput,
  SetOrgProfileInput,
  SetOrgProfileLinkInput,
  SetTakenDownInput,
  SetTeamMembersInput,
  SuspendCredentialsInput,
  UnsuspendCredentialInput,
  UpdateTeamInput,
} from "./types.js";

type Properties<T> = Required<{
  [K in keyof T]: z.ZodType<T[K]>;
}>;

type definedNonNullAny = {};

export const isDefinedNonNullAny = (v: any): v is definedNonNullAny =>
  v !== undefined && v !== null;

export const definedNonNullAnySchema = z
  .any()
  .refine((v) => isDefinedNonNullAny(v));

export const RenownOrgDomainStatusSchema = z.enum([
  "LAPSED",
  "PENDING",
  "VERIFIED",
]);

export const RenownOrgMemberStatusSchema = z.enum([
  "ACTIVE",
  "DECLINED",
  "INVITED",
  "LEFT",
  "REMOVED",
  "REVOKED",
]);

export const RenownOrgRoleSchema = z.enum([
  "ADMIN",
  "MEMBER",
  "OWNER",
  "PUBLISHER",
]);

export function AddDomainInputSchema(): z.ZodObject<
  Properties<AddDomainInput>
> {
  return z.object({
    domain: z.string(),
    id: z.string(),
  });
}

export function AddOrgAppInputSchema(): z.ZodObject<
  Properties<AddOrgAppInput>
> {
  return z.object({
    addedAt: z.iso.datetime(),
    appDid: z.string(),
  });
}

export function AddTeamInputSchema(): z.ZodObject<Properties<AddTeamInput>> {
  return z.object({
    appDids: z.array(z.string()),
    id: z.string(),
    name: z.string(),
    slug: z.string(),
  });
}

export function ArchiveOrgInputSchema(): z.ZodObject<
  Properties<ArchiveOrgInput>
> {
  return z.object({
    archivedAt: z.iso.datetime(),
  });
}

export function InitOrganizationInputSchema(): z.ZodObject<
  Properties<InitOrganizationInput>
> {
  return z.object({
    createdBy: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, {
        message: "Invalid Ethereum address format",
      }),
    handle: z.string(),
    name: z.string(),
  });
}

export function InviteMemberInputSchema(): z.ZodObject<
  Properties<InviteMemberInput>
> {
  return z.object({
    address: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, {
        message: "Invalid Ethereum address format",
      }),
    id: z.string(),
    invitedAt: z.iso.datetime(),
    role: RenownOrgRoleSchema,
  });
}

export function RemoveDomainInputSchema(): z.ZodObject<
  Properties<RemoveDomainInput>
> {
  return z.object({
    id: z.string(),
  });
}

export function RemoveOrgAppInputSchema(): z.ZodObject<
  Properties<RemoveOrgAppInput>
> {
  return z.object({
    appDid: z.string(),
  });
}

export function RemoveTeamInputSchema(): z.ZodObject<
  Properties<RemoveTeamInput>
> {
  return z.object({
    id: z.string(),
  });
}

export function RenownOrgAppSchema(): z.ZodObject<Properties<RenownOrgApp>> {
  return z.object({
    __typename: z.literal("RenownOrgApp").optional(),
    addedAt: z.iso.datetime(),
    appDid: z.string(),
    frozen: z.boolean(),
  });
}

export function RenownOrgAppScopeSchema(): z.ZodObject<
  Properties<RenownOrgAppScope>
> {
  return z.object({
    __typename: z.literal("RenownOrgAppScope").optional(),
    all: z.boolean(),
    appDids: z.array(z.string()),
  });
}

export function RenownOrgDomainSchema(): z.ZodObject<
  Properties<RenownOrgDomain>
> {
  return z.object({
    __typename: z.literal("RenownOrgDomain").optional(),
    domain: z.string(),
    id: z.string(),
    status: RenownOrgDomainStatusSchema,
    verifiedAt: z.iso.datetime().nullish(),
  });
}

export function RenownOrgLinkSchema(): z.ZodObject<Properties<RenownOrgLink>> {
  return z.object({
    __typename: z.literal("RenownOrgLink").optional(),
    id: z.string(),
    label: z.string(),
    url: z.string(),
  });
}

export function RenownOrgMemberSchema(): z.ZodObject<
  Properties<RenownOrgMember>
> {
  return z.object({
    __typename: z.literal("RenownOrgMember").optional(),
    address: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, {
        message: "Invalid Ethereum address format",
      }),
    appScope: z.lazy(() => RenownOrgAppScopeSchema()),
    hidden: z.boolean(),
    id: z.string(),
    joinedAt: z.iso.datetime().nullish(),
    role: RenownOrgRoleSchema,
    status: RenownOrgMemberStatusSchema,
    updatedAt: z.iso.datetime(),
  });
}

export function RenownOrgTeamSchema(): z.ZodObject<Properties<RenownOrgTeam>> {
  return z.object({
    __typename: z.literal("RenownOrgTeam").optional(),
    appDids: z.array(z.string()),
    id: z.string(),
    memberIds: z.array(z.string()),
    name: z.string(),
    slug: z.string(),
  });
}

export function RenownOrganizationStateSchema(): z.ZodObject<
  Properties<RenownOrganizationState>
> {
  return z.object({
    __typename: z.literal("RenownOrganizationState").optional(),
    apps: z.array(z.lazy(() => RenownOrgAppSchema())),
    archived: z.boolean(),
    avatar: z.string().nullish(),
    bio: z.string().nullish(),
    createdBy: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, {
        message: "Invalid Ethereum address format",
      })
      .nullish(),
    domains: z.array(z.lazy(() => RenownOrgDomainSchema())),
    handle: z.string().nullish(),
    links: z.array(z.lazy(() => RenownOrgLinkSchema())),
    listed: z.boolean(),
    members: z.array(z.lazy(() => RenownOrgMemberSchema())),
    membersPublic: z.boolean(),
    name: z.string().nullish(),
    suspendedCredentialIds: z.array(z.string()),
    takenDown: z.boolean(),
    teams: z.array(z.lazy(() => RenownOrgTeamSchema())),
    website: z.string().nullish(),
  });
}

export function SetAppFrozenInputSchema(): z.ZodObject<
  Properties<SetAppFrozenInput>
> {
  return z.object({
    appDid: z.string(),
    frozen: z.boolean(),
  });
}

export function SetDomainStatusInputSchema(): z.ZodObject<
  Properties<SetDomainStatusInput>
> {
  return z.object({
    id: z.string(),
    status: RenownOrgDomainStatusSchema,
    verifiedAt: z.iso.datetime().nullish(),
  });
}

export function SetMemberAppScopeInputSchema(): z.ZodObject<
  Properties<SetMemberAppScopeInput>
> {
  return z.object({
    all: z.boolean(),
    appDids: z.array(z.string()),
    at: z.iso.datetime(),
    id: z.string(),
  });
}

export function SetMemberHiddenInputSchema(): z.ZodObject<
  Properties<SetMemberHiddenInput>
> {
  return z.object({
    at: z.iso.datetime(),
    hidden: z.boolean(),
    id: z.string(),
  });
}

export function SetMemberRoleInputSchema(): z.ZodObject<
  Properties<SetMemberRoleInput>
> {
  return z.object({
    at: z.iso.datetime(),
    id: z.string(),
    role: RenownOrgRoleSchema,
  });
}

export function SetMemberStatusInputSchema(): z.ZodObject<
  Properties<SetMemberStatusInput>
> {
  return z.object({
    at: z.iso.datetime(),
    id: z.string(),
    status: RenownOrgMemberStatusSchema,
  });
}

export function SetMembersPublicInputSchema(): z.ZodObject<
  Properties<SetMembersPublicInput>
> {
  return z.object({
    membersPublic: z.boolean(),
  });
}

export function SetOrgHandleInputSchema(): z.ZodObject<
  Properties<SetOrgHandleInput>
> {
  return z.object({
    handle: z.string(),
  });
}

export function SetOrgListedInputSchema(): z.ZodObject<
  Properties<SetOrgListedInput>
> {
  return z.object({
    listed: z.boolean(),
  });
}

export function SetOrgProfileInputSchema(): z.ZodObject<
  Properties<SetOrgProfileInput>
> {
  return z.object({
    avatar: z.string().nullish(),
    bio: z.string().nullish(),
    links: z.array(z.lazy(() => SetOrgProfileLinkInputSchema())).nullish(),
    name: z.string().nullish(),
    website: z.string().nullish(),
  });
}

export function SetOrgProfileLinkInputSchema(): z.ZodObject<
  Properties<SetOrgProfileLinkInput>
> {
  return z.object({
    id: z.string(),
    label: z.string(),
    url: z.string(),
  });
}

export function SetTakenDownInputSchema(): z.ZodObject<
  Properties<SetTakenDownInput>
> {
  return z.object({
    takenDown: z.boolean(),
  });
}

export function SetTeamMembersInputSchema(): z.ZodObject<
  Properties<SetTeamMembersInput>
> {
  return z.object({
    id: z.string(),
    memberIds: z.array(z.string()),
  });
}

export function SuspendCredentialsInputSchema(): z.ZodObject<
  Properties<SuspendCredentialsInput>
> {
  return z.object({
    credentialIds: z.array(z.string()),
  });
}

export function UnsuspendCredentialInputSchema(): z.ZodObject<
  Properties<UnsuspendCredentialInput>
> {
  return z.object({
    credentialId: z.string(),
  });
}

export function UpdateTeamInputSchema(): z.ZodObject<
  Properties<UpdateTeamInput>
> {
  return z.object({
    appDids: z.array(z.string()).nullish(),
    id: z.string(),
    name: z.string().nullish(),
    slug: z.string().nullish(),
  });
}
