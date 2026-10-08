/* eslint-disable @typescript-eslint/no-empty-object-type */
/* eslint-disable @typescript-eslint/no-unused-vars */
import * as z from "zod";
import type {
  RenownUserStat,
  RenownUserStatsState,
  SetStatInput,
  SetUserDidInput,
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

export function RenownUserStatSchema(): z.ZodObject<
  Properties<RenownUserStat>
> {
  return z.object({
    __typename: z.literal("RenownUserStat").optional(),
    appDid: z.string(),
    id: z.string(),
    metric: z.string(),
    updatedAt: z.iso.datetime(),
    value: z.number(),
  });
}

export function RenownUserStatsStateSchema(): z.ZodObject<
  Properties<RenownUserStatsState>
> {
  return z.object({
    __typename: z.literal("RenownUserStatsState").optional(),
    stats: z.array(z.lazy(() => RenownUserStatSchema())),
    userDid: z.string().nullish(),
  });
}

export function SetStatInputSchema(): z.ZodObject<Properties<SetStatInput>> {
  return z.object({
    appDid: z.string(),
    id: z.string(),
    metric: z.string(),
    updatedAt: z.iso.datetime(),
    value: z.number(),
  });
}

export function SetUserDidInputSchema(): z.ZodObject<
  Properties<SetUserDidInput>
> {
  return z.object({
    userDid: z.string(),
  });
}
