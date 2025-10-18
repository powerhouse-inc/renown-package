import { z } from "zod";
import type {
  AddAuthorizationInput,
  Authorization,
  RemoveAuthorizationInput,
  RenownUserState,
  RevokeAuthorizationInput,
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

export function AddAuthorizationInputSchema(): z.ZodObject<
  Properties<AddAuthorizationInput>
> {
  return z.object({
    audience: z.string().nullish(),
    createdAt: z.string().datetime(),
    id: z.string(),
    issuer: z.string().nullish(),
    jwt: z.string(),
    payload: z.string().nullish(),
    subject: z.string().nullish(),
  });
}

export function AuthorizationSchema(): z.ZodObject<Properties<Authorization>> {
  return z.object({
    __typename: z.literal("Authorization").optional(),
    audience: z.string().nullable(),
    createdAt: z.string().datetime().nullable(),
    id: z.string(),
    issuer: z.string().nullable(),
    jwt: z.string(),
    payload: z.string().nullable(),
    revoked: z.boolean().nullable(),
    revokedAt: z.string().datetime().nullable(),
    subject: z.string().nullable(),
  });
}

export function RemoveAuthorizationInputSchema(): z.ZodObject<
  Properties<RemoveAuthorizationInput>
> {
  return z.object({
    id: z.string(),
  });
}

export function RenownUserStateSchema(): z.ZodObject<
  Properties<RenownUserState>
> {
  return z.object({
    __typename: z.literal("RenownUserState").optional(),
    authorizations: z.array(AuthorizationSchema()),
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

export function RevokeAuthorizationInputSchema(): z.ZodObject<
  Properties<RevokeAuthorizationInput>
> {
  return z.object({
    id: z.string(),
    revokedAt: z.string().datetime(),
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
