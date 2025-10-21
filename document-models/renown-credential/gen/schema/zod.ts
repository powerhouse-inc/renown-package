import { z } from "zod";
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
  [K in keyof T]: z.ZodType<T[K], any, T[K]>;
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
    jwt: z.string(),
  });
}

export function RenownCredentialStateSchema(): z.ZodObject<
  Properties<RenownCredentialState>
> {
  return z.object({
    __typename: z.literal("RenownCredentialState").optional(),
    context: z.array(z.string()).nullable(),
    credentialStatus: CredentialStatusSchema().nullable(),
    credentialSubject: z.string().nullable(),
    expirationDate: z.string().datetime().nullable(),
    id: z.string().nullable(),
    issuanceDate: z.string().datetime().nullable(),
    issuer: z.string().nullable(),
    jwt: z.string().nullable(),
    jwtVerified: z.boolean().nullable(),
    revocationReason: z.string().nullable(),
    revoked: z.boolean().nullable(),
    revokedAt: z.string().datetime().nullable(),
    type: z.array(z.string()).nullable(),
    vcPayload: z.string().nullable(),
  });
}

export function RevokeInputSchema(): z.ZodObject<Properties<RevokeInput>> {
  return z.object({
    reason: z.string().nullish(),
    revokedAt: z.string().datetime(),
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
