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

// ---------- Customers ----------

export const CustomerCreateInput = z
  .object({
    name: z.string().min(1).max(200),
    phone: z.string().max(20).optional(),
    email: z.string().email().max(200).optional(),
  })
  .refine((v) => (v.phone && v.phone.trim() !== "") || (v.email && v.email.trim() !== ""), {
    message: "phone or email is required",
  });
export type CustomerCreateInput = z.infer<typeof CustomerCreateInput>;

export const Customer = z.object({
  id: z.string(),
  merchantId: z.string(),
  name: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  createdAt: z.string(),
});
export type Customer = z.infer<typeof Customer>;

// ---------- Cards ----------

export const CardCreateInput = z.object({
  customerId: z.string().min(1),
  programId: z.string().min(1),
});
export type CardCreateInput = z.infer<typeof CardCreateInput>;

export const Card = z.object({
  id: z.string(),
  merchantId: z.string(),
  customerId: z.string(),
  programId: z.string(),
  customerName: z.string().nullable(),
  programName: z.string(),
  stampsRequired: z.number().int().positive(),
  cardState: z.unknown(), // typed at usage site via the CardState union from index.ts
  qrToken: z.string(),
  status: z.enum(["active", "blocked"]),
  rewardText: z.string(),
  createdAt: z.string(),
  lastEventAt: z.string().nullable(),
});
export type Card = z.infer<typeof Card>;

export const CardEvent = z.object({
  id: z.number(),
  cardId: z.string(),
  eventType: z.enum([
    "stamp",
    "redeem",
    "reset",
    "manual_adjust",
    "points_add",
    "review_reward",
    "signup",
    "expire",
  ]),
  deltaJson: z.unknown(),
  note: z.string().nullable(),
  createdAt: z.string(),
});
export type CardEvent = z.infer<typeof CardEvent>;

export const CardDetail = z.object({
  card: Card,
  events: z.array(CardEvent),
});
export type CardDetail = z.infer<typeof CardDetail>;

// ---------- Wallet ----------

export const WalletLink = z.object({
  available: z.boolean(),
  url: z.string().url().nullable(),
});
export type WalletLink = z.infer<typeof WalletLink>;

// ---------- Scan ----------

export const ScanInput = z.object({
  qrToken: z.string().length(64),
  // "auto" stamps when below threshold, redeems when at threshold.
  action: z.enum(["auto", "stamp", "redeem"]).default("auto"),
});
export type ScanInput = z.infer<typeof ScanInput>;

export const ScanResult = z.object({
  detail: CardDetail,
  appliedAction: z.enum(["stamp", "redeem"]),
});
export type ScanResult = z.infer<typeof ScanResult>;
