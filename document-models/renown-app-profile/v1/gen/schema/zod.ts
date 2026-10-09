/* eslint-disable @typescript-eslint/no-empty-object-type */
/* eslint-disable @typescript-eslint/no-unused-vars */
import * as z from "zod";
import type {
  AddLinkInput,
  RemoveLinkInput,
  RenownAppLink,
  RenownAppProfileState,
  ReorderLinksInput,
  SetAppDidInput,
  SetProfileInput,
  SetPublisherDidInput,
  UpdateLinkInput,
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

export function AddLinkInputSchema(): z.ZodObject<Properties<AddLinkInput>> {
  return z.object({
    id: z.string(),
    label: z.string(),
    url: z.url(),
  });
}

export function RemoveLinkInputSchema(): z.ZodObject<
  Properties<RemoveLinkInput>
> {
  return z.object({
    id: z.string(),
  });
}

export function RenownAppLinkSchema(): z.ZodObject<Properties<RenownAppLink>> {
  return z.object({
    __typename: z.literal("RenownAppLink").optional(),
    id: z.string(),
    label: z.string(),
    url: z.url(),
  });
}

export function RenownAppProfileStateSchema(): z.ZodObject<
  Properties<RenownAppProfileState>
> {
  return z.object({
    __typename: z.literal("RenownAppProfileState").optional(),
    appDid: z.string().nullish(),
    category: z.string().nullish(),
    coverRef: z
      .custom<`attachment://v${number}:${string}`>((val) =>
        /^attachment:\/\/v\d+:.+$/.test(val as string),
      )
      .nullish(),
    description: z.string().nullish(),
    links: z.array(z.lazy(() => RenownAppLinkSchema())),
    logo: z.string().nullish(),
    logoRef: z
      .custom<`attachment://v${number}:${string}`>((val) =>
        /^attachment:\/\/v\d+:.+$/.test(val as string),
      )
      .nullish(),
    name: z.string().nullish(),
    publisherDid: z.string().nullish(),
    tagline: z.string().nullish(),
    website: z.string().nullish(),
  });
}

export function ReorderLinksInputSchema(): z.ZodObject<
  Properties<ReorderLinksInput>
> {
  return z.object({
    linkIds: z.array(z.string()),
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
    category: z.string().nullish(),
    coverRef: z.string().nullish(),
    description: z.string().nullish(),
    logo: z.string().nullish(),
    logoRef: z.string().nullish(),
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

export function UpdateLinkInputSchema(): z.ZodObject<
  Properties<UpdateLinkInput>
> {
  return z.object({
    id: z.string(),
    label: z.string().nullish(),
    url: z.url().nullish(),
  });
}
