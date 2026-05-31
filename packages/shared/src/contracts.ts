import { z } from "zod";

// ---------- Auth ----------

export const AuthRequestInput = z.object({
  email: z.string().email().max(200),
});
export type AuthRequestInput = z.infer<typeof AuthRequestInput>;

export const AuthRequestResult = z.object({
  ok: z.literal(true),
  // Only populated in development to make local testing painless.
  devMagicLink: z.string().url().optional(),
});
export type AuthRequestResult = z.infer<typeof AuthRequestResult>;

export const AuthVerifyInput = z.object({
  token: z.string().min(32).max(64),
});
export type AuthVerifyInput = z.infer<typeof AuthVerifyInput>;

export const SessionUser = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string().nullable(),
  role: z.enum(["owner", "staff"]),
  merchantId: z.string(),
});
export type SessionUser = z.infer<typeof SessionUser>;

export const Merchant = z.object({
  id: z.string(),
  businessName: z.string(),
  ownerEmail: z.string().email(),
  country: z.string(),
  status: z.enum(["active", "suspended", "trial"]),
});
export type Merchant = z.infer<typeof Merchant>;

export const AuthVerifyResult = z.object({
  jwt: z.string(),
  user: SessionUser,
  merchant: Merchant,
});
export type AuthVerifyResult = z.infer<typeof AuthVerifyResult>;

// ---------- Merchant signup ----------

export const MerchantSignupInput = z.object({
  businessName: z.string().min(1).max(200),
  ownerEmail: z.string().email().max(200),
  ownerName: z.string().max(200).optional(),
});
export type MerchantSignupInput = z.infer<typeof MerchantSignupInput>;

export const MerchantSignupResult = z.object({
  merchant: Merchant,
  user: SessionUser,
});
export type MerchantSignupResult = z.infer<typeof MerchantSignupResult>;

// ---------- Programs ----------

export const StampProgramCreateInput = z.object({
  name: z.string().min(1).max(200),
  stampsRequired: z.number().int().positive().max(100),
  rewardText: z.string().min(1).max(500),
});
export type StampProgramCreateInput = z.infer<typeof StampProgramCreateInput>;

export const Program = z.object({
  id: z.string(),
  merchantId: z.string(),
  name: z.string(),
  programType: z.enum([
    "stamp",
    "points",
    "membership",
    "multipass",
    "discount",
    "cashback",
    "gift",
    "coupon",
  ]),
  configJson: z.unknown(),
  rewardText: z.string(),
  active: z.boolean(),
  createdAt: z.string(),
});
export type Program = z.infer<typeof Program>;
