/* eslint-disable @typescript-eslint/no-empty-object-type */
/* eslint-disable @typescript-eslint/no-unused-vars */
import * as z from "zod";
import type {
  RenownAppProfileState,
  SetAppDidInput,
  SetProfileInput,
  SetPublisherDidInput,
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

export function RenownAppProfileStateSchema(): z.ZodObject<
  Properties<RenownAppProfileState>
> {
  return z.object({
    __typename: z.literal("RenownAppProfileState").optional(),
    appDid: z.string().nullish(),
    logo: z.string().nullish(),
    name: z.string().nullish(),
    publisherDid: z.string().nullish(),
    tagline: z.string().nullish(),
    website: z.string().nullish(),
  });
}

export function SetAppDidInputSchema(): z.ZodObject<
  Properties<SetAppDidInput>
> {
  return z.object({
    appDid: z.string(),
  });
}

export function SetProfileInputSchema(): z.ZodObject<
  Properties<SetProfileInput>
> {
  return z.object({
    logo: z.string().nullish(),
    name: z.string().nullish(),
    tagline: z.string().nullish(),
    website: z.string().nullish(),
  });
}

export function SetPublisherDidInputSchema(): z.ZodObject<
  Properties<SetPublisherDidInput>
> {
  return z.object({
    publisherDid: z.string(),
  });
}
