import { z } from "zod";
import type {
  CredentialSchema,
  CredentialSchemaInput,
  CredentialStatus,
  CredentialStatusInput,
  CredentialSubject,
  CredentialSubjectInput,
  Eip712,
  Eip712Domain,
  Eip712DomainInput,
  Eip712Input,
  InitInput,
  Issuer,
  IssuerInput,
  Proof,
  ProofInput,
  RenownCredentialState,
  RevokeInput,
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

export function CredentialSchemaSchema(): z.ZodObject<
  Properties<CredentialSchema>
> {
  return z.object({
    __typename: z.literal("CredentialSchema").optional(),
    id: z.string(),
    type: z.string(),
  });
}

export function CredentialSchemaInputSchema(): z.ZodObject<
  Properties<CredentialSchemaInput>
> {
  return z.object({
    id: z.string(),
    type: z.string(),
  });
}

export function CredentialStatusSchema(): z.ZodObject<
  Properties<CredentialStatus>
> {
  return z.object({
    __typename: z.literal("CredentialStatus").optional(),
    id: z.string(),
    type: z.string(),
  });
}

export function CredentialStatusInputSchema(): z.ZodObject<
  Properties<CredentialStatusInput>
> {
  return z.object({
    id: z.string(),
    type: z.string(),
  });
}

export function CredentialSubjectSchema(): z.ZodObject<
  Properties<CredentialSubject>
> {
  return z.object({
    __typename: z.literal("CredentialSubject").optional(),
    app: z.string(),
    id: z.string().nullable(),
  });
}

export function CredentialSubjectInputSchema(): z.ZodObject<
  Properties<CredentialSubjectInput>
> {
  return z.object({
    app: z.string(),
    id: z.string().nullish(),
  });
}

export function Eip712Schema(): z.ZodObject<Properties<Eip712>> {
  return z.object({
    __typename: z.literal("EIP712").optional(),
    domain: Eip712DomainSchema(),
    primaryType: z.string(),
  });
}

export function Eip712DomainSchema(): z.ZodObject<Properties<Eip712Domain>> {
  return z.object({
    __typename: z.literal("EIP712Domain").optional(),
    chainId: z.number(),
    version: z.string(),
  });
}

export function Eip712DomainInputSchema(): z.ZodObject<
  Properties<Eip712DomainInput>
> {
  return z.object({
    chainId: z.number(),
    version: z.string(),
  });
}

export function Eip712InputSchema(): z.ZodObject<Properties<Eip712Input>> {
  return z.object({
    domain: z.lazy(() => Eip712DomainInputSchema()),
    primaryType: z.string(),
  });
}

export function InitInputSchema(): z.ZodObject<Properties<InitInput>> {
  return z.object({
    context: z.array(z.string()),
    credentialSchema: z.lazy(() => CredentialSchemaInputSchema()),
    credentialStatus: z.lazy(() => CredentialStatusInputSchema().nullish()),
    credentialSubject: z.lazy(() => CredentialSubjectInputSchema()),
    expirationDate: z.string().datetime().nullish(),
    id: z.string(),
    issuanceDate: z.string().datetime(),
    issuer: z.lazy(() => IssuerInputSchema()),
    proof: z.lazy(() => ProofInputSchema()),
    type: z.array(z.string()),
  });
}

export function IssuerSchema(): z.ZodObject<Properties<Issuer>> {
  return z.object({
    __typename: z.literal("Issuer").optional(),
    ethereumAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, {
        message: "Invalid Ethereum address format",
      }),
    id: z.string(),
  });
}

export function IssuerInputSchema(): z.ZodObject<Properties<IssuerInput>> {
  return z.object({
    ethereumAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, {
        message: "Invalid Ethereum address format",
      }),
    id: z.string(),
  });
}

export function ProofSchema(): z.ZodObject<Properties<Proof>> {
  return z.object({
    __typename: z.literal("Proof").optional(),
    created: z.string().datetime(),
    eip712: Eip712Schema(),
    ethereumAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, {
        message: "Invalid Ethereum address format",
      }),
    proofPurpose: z.string(),
    proofValue: z.string(),
    type: z.string(),
    verificationMethod: z.string(),
  });
}

export function ProofInputSchema(): z.ZodObject<Properties<ProofInput>> {
  return z.object({
    created: z.string().datetime(),
    eip712: z.lazy(() => Eip712InputSchema()),
    ethereumAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, {
        message: "Invalid Ethereum address format",
      }),
    proofPurpose: z.string(),
    proofValue: z.string(),
    type: z.string(),
    verificationMethod: z.string(),
  });
}

export function RenownCredentialStateSchema(): z.ZodObject<
  Properties<RenownCredentialState>
> {
  return z.object({
    __typename: z.literal("RenownCredentialState").optional(),
    context: z.array(z.string()),
    credentialSchema: CredentialSchemaSchema(),
    credentialStatus: CredentialStatusSchema().nullable(),
    credentialSubject: CredentialSubjectSchema(),
    expirationDate: z.string().datetime().nullable(),
    id: z.string(),
    issuanceDate: z.string().datetime(),
    issuer: IssuerSchema(),
    proof: ProofSchema(),
    revocationReason: z.string().nullable(),
    revoked: z.boolean(),
    revokedAt: z.string().datetime().nullable(),
    type: z.array(z.string()),
  });
}

export function RevokeInputSchema(): z.ZodObject<Properties<RevokeInput>> {
  return z.object({
    reason: z.string().nullish(),
    revokedAt: z.string().datetime(),
  });
}
