import * as z from "zod";
import type {
  CredentialStatus,
  InitInput,
  RenownCredentialState,
  RevokeInput,
  SetCredentialStatusInput,
  SetJwtInput,
  UpdateCredentialSubjectInput,
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

export function CredentialStatusSchema(): z.ZodObject<
  Properties<CredentialStatus>
> {
  return z.object({
    __typename: z.literal("CredentialStatus").optional(),
    id: z.string(),
    statusListCredential: z.string(),
    statusListIndex: z.string(),
    statusPurpose: z.string(),
    type: z.string(),
  });
}

export function InitInputSchema(): z.ZodObject<Properties<InitInput>> {
  return z.object({
    context: z.array(z.string()).nullish(),
    credentialSubject: z.string(),
    expirationDate: z.iso.datetime().nullish(),
    id: z.string().nullish(),
    issuanceDate: z.iso.datetime(),
    issuer: z.string(),
    type: z.array(z.string()).nullish(),
  });
}

export function RenownCredentialStateSchema(): z.ZodObject<
  Properties<RenownCredentialState>
> {
  return z.object({
    __typename: z.literal("RenownCredentialState").optional(),
    context: z.array(z.string()),
    credentialStatus: z.lazy(() => CredentialStatusSchema().nullish()),
    credentialSubject: z.string(),
    expirationDate: z.iso.datetime().nullish(),
    id: z.string().nullish(),
    issuanceDate: z.iso.datetime(),
    issuer: z.string(),
    jwt: z.string().nullish(),
    revocationReason: z.string().nullish(),
    revoked: z.boolean().nullish(),
    revokedAt: z.iso.datetime().nullish(),
    type: z.array(z.string()),
  });
}

export function RevokeInputSchema(): z.ZodObject<Properties<RevokeInput>> {
  return z.object({
    reason: z.string().nullish(),
    revokedAt: z.iso.datetime(),
  });
}

export function SetCredentialStatusInputSchema(): z.ZodObject<
  Properties<SetCredentialStatusInput>
> {
  return z.object({
    statusId: z.string(),
    statusListCredential: z.string(),
    statusListIndex: z.string(),
    statusPurpose: z.string(),
    statusType: z.string(),
  });
}

export function SetJwtInputSchema(): z.ZodObject<Properties<SetJwtInput>> {
  return z.object({
    jwt: z.string(),
  });
}

export function UpdateCredentialSubjectInputSchema(): z.ZodObject<
  Properties<UpdateCredentialSubjectInput>
> {
  return z.object({
    credentialSubject: z.string(),
  });
}
