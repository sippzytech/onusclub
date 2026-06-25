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

// ---------- Password auth ----------

export const PasswordSignupInput = z.object({
  businessName: z.string().min(1).max(200),
  ownerEmail: z.string().email().max(200),
  ownerName: z.string().max(200).optional(),
  password: z.string().min(8).max(200),
});
export type PasswordSignupInput = z.infer<typeof PasswordSignupInput>;

export const PasswordLoginInput = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});
export type PasswordLoginInput = z.infer<typeof PasswordLoginInput>;

export const PasswordAuthResult = z.object({
  jwt: z.string(),
  user: SessionUser,
  merchant: Merchant,
  publicSlug: z.string(),
});
export type PasswordAuthResult = z.infer<typeof PasswordAuthResult>;

// ---------- Merchant preferences (premium gate + cron switch) ----------

export const MerchantPreferences = z.object({
  isPremium: z.boolean(),
  cronsEnabled: z.boolean(),
});
export type MerchantPreferences = z.infer<typeof MerchantPreferences>;

export const MerchantPreferencesInput = z.object({
  isPremium: z.boolean().optional(),
  cronsEnabled: z.boolean().optional(),
});
export type MerchantPreferencesInput = z.infer<typeof MerchantPreferencesInput>;

// ---------- Forgot / reset password ----------

export const ForgotPasswordInput = z.object({
  email: z.string().email().max(200),
});
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordInput>;

export const ForgotPasswordResult = z.object({
  ok: z.literal(true),
  // Only present in dev so smoke tests don't need Resend to verify the flow.
  devResetLink: z.string().url().optional(),
});
export type ForgotPasswordResult = z.infer<typeof ForgotPasswordResult>;

export const ResetPasswordInput = z.object({
  token: z.string().min(32).max(64),
  password: z.string().min(8).max(200),
});
export type ResetPasswordInput = z.infer<typeof ResetPasswordInput>;

// ---------- Staff (team) accounts ----------

export const StaffMember = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string().nullable(),
  role: z.enum(["owner", "staff"]),
  createdAt: z.string(),
});
export type StaffMember = z.infer<typeof StaffMember>;

export const StaffCreateInput = z.object({
  email: z.string().email().max(200),
  name: z.string().max(200).optional(),
  password: z.string().min(8).max(200),
});
export type StaffCreateInput = z.infer<typeof StaffCreateInput>;

// ---------- Programs ----------

export const StampProgramCreateInput = z.object({
  programType: z.literal("stamp"),
  name: z.string().min(1).max(200),
  stampsRequired: z.number().int().positive().max(100),
  rewardText: z.string().min(1).max(500),
  // Optional: card expires after this many days of inactivity (no stamp /
  // redeem events). The expiry sweep flips status to 'expired' and PATCHes
  // the Wallet pass to state EXPIRED so it moves to Inactive in Wallet.
  expiryDays: z.number().int().positive().max(3650).optional(),
});
export type StampProgramCreateInput = z.infer<typeof StampProgramCreateInput>;

export const PointsProgramCreateInput = z.object({
  programType: z.literal("points"),
  name: z.string().min(1).max(200),
  rewardText: z.string().min(1).max(500),
  // 1 € spent → N points. Defaults to 1 client-side but the API requires it
  // explicitly so there's no ambiguity about a merchant's rule.
  pointsPerEuro: z.number().positive().max(1000),
  // Threshold for the reward (1000 = "1000 points = free coffee").
  pointsForReward: z.number().int().positive().max(1_000_000),
  // Per-batch expiry. Each "add points" transaction gets its own expires_at
  // = NOW + batchExpiryDays. Omit for batches that never expire.
  batchExpiryDays: z.number().int().positive().max(3650).optional(),
});
export type PointsProgramCreateInput = z.infer<typeof PointsProgramCreateInput>;

// Discriminated union so the create endpoint can switch on programType.
// Clients legacy enough to omit programType default to "stamp" via a
// preprocessor in routes/programs.ts (keeps Day 1-13 callers working).
export const ProgramCreateInput = z.discriminatedUnion("programType", [
  StampProgramCreateInput,
  PointsProgramCreateInput,
]);
export type ProgramCreateInput = z.infer<typeof ProgramCreateInput>;

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
    // ISO date string like "1990-04-23". Year is stored but the sweep matches
    // on month+day only, so any year is fine.
    birthday: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD")
      .optional(),
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
  birthday: z.string().nullable(),
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
  programType: z.enum(["stamp", "points"]),
  // For stamp programs: the threshold number of stamps. 0 for points programs.
  stampsRequired: z.number().int().nonnegative(),
  // For points programs: threshold + euro→points rate. Null for stamp programs.
  pointsForReward: z.number().int().positive().nullable(),
  pointsPerEuro: z.number().positive().nullable(),
  cardState: z.unknown(), // typed at usage site via the CardState union from index.ts
  qrToken: z.string(),
  status: z.enum(["active", "blocked", "expired"]),
  rewardText: z.string(),
  createdAt: z.string(),
  lastEventAt: z.string().nullable(),
});
export type Card = z.infer<typeof Card>;

// Body for POST /v1/cards/:id/add-points. Merchant enters the transaction
// amount; the api computes points = amount * program.pointsPerEuro (floored).
export const AddPointsInput = z.object({
  amount: z.number().positive().max(100_000),
});
export type AddPointsInput = z.infer<typeof AddPointsInput>;

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

// ---------- Public per-merchant signup (customer-facing QR flow) ----------

export const PublicProgram = z.object({
  id: z.string(),
  name: z.string(),
  stampsRequired: z.number().int().positive(),
  rewardText: z.string(),
});
export type PublicProgram = z.infer<typeof PublicProgram>;

export const PublicMerchant = z.object({
  businessName: z.string(),
  brandColor: z.string().nullable(),
  logoUrl: z.string().nullable(),
  publicSlug: z.string(),
  programs: z.array(PublicProgram),
});
export type PublicMerchant = z.infer<typeof PublicMerchant>;

export const PublicEnrolInput = z
  .object({
    name: z.string().min(1).max(200),
    phone: z.string().max(20).optional(),
    email: z.string().email().max(200).optional(),
    birthday: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD")
      .optional(),
    programId: z.string().min(1),
  })
  .refine(
    (v) => (v.phone && v.phone.trim() !== "") || (v.email && v.email.trim() !== ""),
    { message: "phone or email is required" }
  );
export type PublicEnrolInput = z.infer<typeof PublicEnrolInput>;

export const PublicEnrolResult = z.object({
  walletSaveUrl: z.string().url().nullable(),
  // true if we matched an existing customer by email/phone and returned that
  // card instead of creating a new one. UI uses this to show "Welcome back".
  existing: z.boolean(),
});
export type PublicEnrolResult = z.infer<typeof PublicEnrolResult>;

// Customer-facing read of their own card. Sanitised — only the customer's
// own name + program/business + state. No event history, no other customer
// data, no merchant secrets. Access controlled solely by knowledge of the
// 64-char qr_token (unguessable).
export const PublicCardView = z.object({
  businessName: z.string(),
  brandColor: z.string().nullable(),
  customerName: z.string().nullable(),
  programName: z.string(),
  programType: z.enum(["stamp", "points"]),
  rewardText: z.string(),
  // For stamp programs: `currentValue` = stamps_current, `targetValue` =
  // stamps_required, `unitLabel` = "stamps".
  // For points programs: `currentValue` = points_current (sum of non-expired
  // batches), `targetValue` = points_for_reward, `unitLabel` = "points".
  // Old `stampsCurrent` / `stampsRequired` retained for legacy clients but
  // populated with the points equivalents when programType=points.
  currentValue: z.number().int(),
  targetValue: z.number().int(),
  unitLabel: z.enum(["stamps", "points"]),
  stampsCurrent: z.number().int(),
  stampsRequired: z.number().int(),
  rewardsRedeemed: z.number().int(),
  status: z.enum(["active", "blocked", "expired"]),
  walletSaveUrl: z.string().url().nullable(),
});
export type PublicCardView = z.infer<typeof PublicCardView>;

// ---------- Messaging (broadcasts + sweeps) ----------

export const AudienceFilter = z.object({
  // Send only to cards where total_lifetime stamps is at least this number.
  minLifetimeStamps: z.number().int().nonnegative().max(10000).optional(),
  // Send only to customers whose birthday month matches the current
  // server-side calendar month.
  withBirthdayThisMonth: z.boolean().optional(),
  // Send only to cards under this specific program id (must belong to merchant).
  programId: z.string().optional(),
});
export type AudienceFilter = z.infer<typeof AudienceFilter>;

export const BroadcastCreateInput = z.object({
  header: z.string().min(1).max(60),
  body: z.string().min(1).max(200),
  audienceFilter: AudienceFilter.optional(),
});
export type BroadcastCreateInput = z.infer<typeof BroadcastCreateInput>;

export const RunStatus = z.enum(["running", "completed", "failed"]);
export type RunStatus = z.infer<typeof RunStatus>;

export const Broadcast = z.object({
  id: z.string(),
  merchantId: z.string(),
  header: z.string(),
  body: z.string(),
  audienceFilter: AudienceFilter.nullable().optional(),
  status: RunStatus,
  scanned: z.number().int(),
  sent: z.number().int(),
  failed: z.number().int(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type Broadcast = z.infer<typeof Broadcast>;

export const SweepType = z.enum(["birthday", "inactivity"]);
export type SweepType = z.infer<typeof SweepType>;

export const SweepRun = z.object({
  id: z.string(),
  sweepType: SweepType,
  status: RunStatus,
  scanned: z.number().int(),
  sent: z.number().int(),
  failed: z.number().int(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  errorMessage: z.string().nullable(),
});
export type SweepRun = z.infer<typeof SweepRun>;

export const DeliveryStatus = z.enum(["pending", "sent", "failed"]);
export type DeliveryStatus = z.infer<typeof DeliveryStatus>;

export const MessageDelivery = z.object({
  id: z.number(),
  sourceType: z.enum(["broadcast", "birthday", "inactivity"]),
  sourceId: z.string(),
  merchantId: z.string(),
  cardId: z.string(),
  customerId: z.string(),
  customerName: z.string().nullable(),
  programName: z.string(),
  status: DeliveryStatus,
  attempts: z.number().int(),
  lastError: z.string().nullable(),
  lastAttemptAt: z.string().nullable(),
  createdAt: z.string(),
});
export type MessageDelivery = z.infer<typeof MessageDelivery>;

// Unified "feed item" shape so the Messages tab can render broadcasts and
// sweep runs in one chronological list.
export const MessageFeedItem = z.object({
  kind: z.enum(["broadcast", "sweep"]),
  id: z.string(),
  sweepType: SweepType.optional(),
  header: z.string(), // broadcast header or "Birthday sweep" / "Inactivity sweep"
  body: z.string().nullable(), // broadcast body, null for sweeps
  status: RunStatus,
  scanned: z.number().int(),
  sent: z.number().int(),
  failed: z.number().int(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type MessageFeedItem = z.infer<typeof MessageFeedItem>;
