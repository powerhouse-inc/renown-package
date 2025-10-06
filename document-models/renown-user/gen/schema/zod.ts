import { z } from "zod";
import type {
  RenownUserState,
  SetEthAddressInput,
  SetUserImageInput,
  SetUsernameInput,
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

export function RenownUserStateSchema(): z.ZodObject<
  Properties<RenownUserState>
> {
  return z.object({
    __typename: z.literal("RenownUserState").optional(),
    ethAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, {
        message: "Invalid Ethereum address format",
      })
      .nullable(),
    userImage: z.string().nullable(),
    username: z.string().nullable(),
  });
}

export function SetEthAddressInputSchema(): z.ZodObject<
  Properties<SetEthAddressInput>
> {
  return z.object({
    ethAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, {
        message: "Invalid Ethereum address format",
      }),
  });
}

export function SetUserImageInputSchema(): z.ZodObject<
  Properties<SetUserImageInput>
> {
  return z.object({
    userImage: z.string(),
  });
}

export function SetUsernameInputSchema(): z.ZodObject<
  Properties<SetUsernameInput>
> {
  return z.object({
    username: z.string(),
  });
}
