/* eslint-disable @typescript-eslint/no-empty-object-type */
/* eslint-disable @typescript-eslint/no-unused-vars */
import * as z from "zod";
import type {
  AddLinkInput,
  AddMetricInput,
  RemoveLinkInput,
  RemoveMetricInput,
  RenownAppLink,
  RenownAppMetric,
  RenownAppProfileState,
  RenownMetricAggregation,
  ReorderLinksInput,
  ReorderMetricsInput,
  SetAppDidInput,
  SetProfileInput,
  SetPublisherDidInput,
  UpdateLinkInput,
  UpdateMetricInput,
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

export const RenownMetricAggregationSchema = z.enum([
  "AVG",
  "COUNT_USERS",
  "MAX",
  "SUM",
]);

export function AddLinkInputSchema(): z.ZodObject<Properties<AddLinkInput>> {
  return z.object({
    id: z.string(),
    label: z.string(),
    url: z.url(),
  });
}

export function AddMetricInputSchema(): z.ZodObject<
  Properties<AddMetricInput>
> {
  return z.object({
    aggregation: RenownMetricAggregationSchema,
    description: z.string().nullish(),
    id: z.string(),
    key: z.string(),
    label: z.string(),
    public: z.boolean(),
    unit: z.string().nullish(),
  });
}

export function RemoveLinkInputSchema(): z.ZodObject<
  Properties<RemoveLinkInput>
> {
  return z.object({
    id: z.string(),
  });
}

export function RemoveMetricInputSchema(): z.ZodObject<
  Properties<RemoveMetricInput>
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

export function RenownAppMetricSchema(): z.ZodObject<
  Properties<RenownAppMetric>
> {
  return z.object({
    __typename: z.literal("RenownAppMetric").optional(),
    aggregation: RenownMetricAggregationSchema,
    description: z.string().nullish(),
    id: z.string(),
    key: z.string(),
    label: z.string(),
    public: z.boolean(),
    unit: z.string().nullish(),
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
    metrics: z.array(z.lazy(() => RenownAppMetricSchema())),
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

export function ReorderMetricsInputSchema(): z.ZodObject<
  Properties<ReorderMetricsInput>
> {
  return z.object({
    metricIds: z.array(z.string()),
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

export function UpdateMetricInputSchema(): z.ZodObject<
  Properties<UpdateMetricInput>
> {
  return z.object({
    aggregation: RenownMetricAggregationSchema.nullish(),
    description: z.string().nullish(),
    id: z.string(),
    key: z.string().nullish(),
    label: z.string().nullish(),
    public: z.boolean().nullish(),
    unit: z.string().nullish(),
  });
}
