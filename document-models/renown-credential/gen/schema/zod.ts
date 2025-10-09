import { z } from "zod";
import type { InitInput, RenownCredentialState, RevokeInput } from "./types.js";

type Properties<T> = Required<{
  [K in keyof T]: z.ZodType<T[K], any, T[K]>;
}>;

type definedNonNullAny = {};

export const isDefinedNonNullAny = (v: any): v is definedNonNullAny =>
  v !== undefined && v !== null;

export const definedNonNullAnySchema = z
  .any()
  .refine((v) => isDefinedNonNullAny(v));

export function InitInputSchema(): z.ZodObject<Properties<InitInput>> {
  return z.object({
    audience: z.string().nullish(),
    issuer: z.string().nullish(),
    jwt: z.string(),
    payload: z.string().nullish(),
    subject: z.string().nullish(),
  });
}

export function RenownCredentialStateSchema(): z.ZodObject<
  Properties<RenownCredentialState>
> {
  return z.object({
    __typename: z.literal("RenownCredentialState").optional(),
    audience: z.string().nullable(),
    issuer: z.string().nullable(),
    jwt: z.string().nullable(),
    payload: z.string().nullable(),
    revoked: z.boolean().nullable(),
    subject: z.string().nullable(),
  });
}

export function RevokeInputSchema(): z.ZodObject<Properties<RevokeInput>> {
  return z.object({
    jwt: z.string().nullish(),
  });
}
