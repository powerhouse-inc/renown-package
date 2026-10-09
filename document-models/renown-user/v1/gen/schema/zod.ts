/* eslint-disable @typescript-eslint/no-empty-object-type */
/* eslint-disable @typescript-eslint/no-unused-vars */
import * as z from "zod";
import type {
  AddLinkInput,
  RemoveLinkInput,
  RenownUserLink,
  RenownUserState,
  ReorderLinksInput,
  SetAvatarInput,
  SetBioInput,
  SetDisplayNameInput,
  SetEthAddressInput,
  SetHandleInput,
  SetUserImageInput,
  SetUsernameInput,
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

export function RenownUserLinkSchema(): z.ZodObject<
  Properties<RenownUserLink>
> {
  return z.object({
    __typename: z.literal("RenownUserLink").optional(),
    id: z.string(),
    label: z.string(),
    url: z.url(),
  });
}

export function RenownUserStateSchema(): z.ZodObject<
  Properties<RenownUserState>
> {
  return z.object({
    __typename: z.literal("RenownUserState").optional(),
    avatar: z
      .custom<`attachment://v${number}:${string}`>((val) =>
        /^attachment:\/\/v\d+:.+$/.test(val as string),
      )
      .nullish(),
    bio: z.string().nullish(),
    displayName: z.string().nullish(),
    ethAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, {
        message: "Invalid Ethereum address format",
      })
      .nullish(),
    handle: z.string().nullish(),
    links: z.array(z.lazy(() => RenownUserLinkSchema())),
    userImage: z.string().nullish(),
    username: z.string().nullish(),
  });
}

export function ReorderLinksInputSchema(): z.ZodObject<
  Properties<ReorderLinksInput>
> {
  return z.object({
    linkIds: z.array(z.string()),
  });
}

export function SetAvatarInputSchema(): z.ZodObject<
  Properties<SetAvatarInput>
> {
  return z.object({
    avatar: z
      .custom<`attachment://v${number}:${string}`>((val) =>
        /^attachment:\/\/v\d+:.+$/.test(val as string),
      )
      .nullish(),
  });
}

export function SetBioInputSchema(): z.ZodObject<Properties<SetBioInput>> {
  return z.object({
    bio: z.string().nullish(),
  });
}

export function SetDisplayNameInputSchema(): z.ZodObject<
  Properties<SetDisplayNameInput>
> {
  return z.object({
    displayName: z.string().nullish(),
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

export function SetHandleInputSchema(): z.ZodObject<
  Properties<SetHandleInput>
> {
  return z.object({
    handle: z.string().nullish(),
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

export function UpdateLinkInputSchema(): z.ZodObject<
  Properties<UpdateLinkInput>
> {
  return z.object({
    id: z.string(),
    label: z.string().nullish(),
    url: z.url().nullish(),
  });
}
