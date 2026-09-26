/* eslint-disable @typescript-eslint/no-empty-object-type */
/* eslint-disable @typescript-eslint/no-unused-vars */
import * as z from "zod";
import type {
  AddAllowedSubjectInput,
  AddRedirectUriInput,
  RemoveAllowedSubjectInput,
  RemoveRedirectUriInput,
  RenownOidcClientState,
  RenownOidcClientStatus,
  SetAllowAnySubjectInput,
  SetClientInfoInput,
  SetClientSecretHashInput,
  SetStatusInput,
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

export const RenownOidcClientStatusSchema = z.enum(["ACTIVE", "DISABLED"]);

export function AddAllowedSubjectInputSchema(): z.ZodObject<
  Properties<AddAllowedSubjectInput>
> {
  return z.object({
    subject: z.string(),
  });
}

export function AddRedirectUriInputSchema(): z.ZodObject<
  Properties<AddRedirectUriInput>
> {
  return z.object({
    uri: z.url(),
  });
}

export function RemoveAllowedSubjectInputSchema(): z.ZodObject<
  Properties<RemoveAllowedSubjectInput>
> {
  return z.object({
    subject: z.string(),
  });
}

export function RemoveRedirectUriInputSchema(): z.ZodObject<
  Properties<RemoveRedirectUriInput>
> {
  return z.object({
    uri: z.url(),
  });
}

export function RenownOidcClientStateSchema(): z.ZodObject<
  Properties<RenownOidcClientState>
> {
  return z.object({
    __typename: z.literal("RenownOidcClientState").optional(),
    allowAnySubject: z.boolean(),
    allowedSubjects: z.array(z.string()),
    clientSecretHash: z.string().nullish(),
    name: z.string().nullish(),
    redirectUris: z.array(z.url()),
    status: RenownOidcClientStatusSchema,
  });
}

export function SetAllowAnySubjectInputSchema(): z.ZodObject<
  Properties<SetAllowAnySubjectInput>
> {
  return z.object({
    allow: z.boolean(),
  });
}

export function SetClientInfoInputSchema(): z.ZodObject<
  Properties<SetClientInfoInput>
> {
  return z.object({
    name: z.string(),
  });
}

export function SetClientSecretHashInputSchema(): z.ZodObject<
  Properties<SetClientSecretHashInput>
> {
  return z.object({
    hash: z.string().nullish(),
  });
}

export function SetStatusInputSchema(): z.ZodObject<
  Properties<SetStatusInput>
> {
  return z.object({
    status: RenownOidcClientStatusSchema,
  });
}
