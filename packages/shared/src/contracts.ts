import { z } from "zod";
import { STAMP_ICON_IDS } from "./card-art.js";

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

// Trial state for the signed-in merchant, derived rather than stored: the
// database holds only `trial_ends_at`, and everything below is computed from it
// against now(). Keeping it derived means a trial cannot drift out of sync with
// its own expiry date.
export const TrialStatus = z.object({
  // ISO timestamp, or null for an account with no trial clock at all —
  // either pre-dating trials or deliberately taken off one.
  endsAt: z.string().nullable(),
  // Whole days remaining, floored, never negative. Null when there is no
  // clock. 0 means the last day — under 24 hours left but not yet past the
  // expiry — which reads as "ends today" rather than "has ended". Flooring is
  // what makes that state reachable at all; with ceil it never occurs.
  daysLeft: z.number().int().nonnegative().nullable(),
  expired: z.boolean(),
});
export type TrialStatus = z.infer<typeof TrialStatus>;

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

// Body for POST /v1/cards/:id/stamp and /:id/redeem. Both used to take no
// body at all; `amount` is the optional sale amount in euros (Day 15 revenue
// capture). Omitting it stamps exactly as before — the merchant skipped the
// prompt — and leaves card_events.amount_cents NULL.
//
// Money crosses the wire in euros because that is the unit a human types at
// the till. The api converts once, at the write boundary, and stores integer
// cents. Nothing downstream of that boundary deals in floats.
export const CardActionInput = z.object({
  amount: z.number().positive().max(100_000).optional(),
});
export type CardActionInput = z.infer<typeof CardActionInput>;

// Body for PATCH /v1/card-events/:id/amount — attaches a sale amount to an
// event that already happened.
//
// The scanner needs this because a stamp must apply the instant the QR is
// read: the one-stamp-per-day rule can reject the scan, and finding that out
// *after* typing an amount would be a worse trade than typing it after. So
// the stamp lands first and the amount is attached to the resulting event.
export const CardEventAmountInput = z.object({
  amount: z.number().positive().max(100_000),
});
export type CardEventAmountInput = z.infer<typeof CardEventAmountInput>;

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
  // Sale amount attributed to this event, in integer minor units. NULL means
  // no amount was captured (prompt skipped, or the event predates Day 15) —
  // deliberately distinct from 0, which would be a real zero-value sale.
  amountCents: z.number().int().nonnegative().nullable(),
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
  // Stamp cards: "auto" stamps when below threshold, redeems when at threshold.
  // Points cards: "auto" returns needs_amount (UI must collect the bill
  // amount before re-calling with action='add-points' + amount).
  // "add-points" + amount is the points equivalent of "stamp" for stamp cards.
  action: z.enum(["auto", "stamp", "redeem", "add-points"]).default("auto"),
  // The sale amount in euros. Two jobs, one field:
  //   - action='add-points' → REQUIRED. Drives the maths: the api computes
  //     points = floor(amount × points_per_euro).
  //   - action='stamp' / 'redeem' / 'auto' on a stamp card → OPTIONAL, and
  //     purely for revenue reporting. The stamp itself is unaffected.
  // Either way it lands in card_events.amount_cents, so revenue aggregates
  // read one column regardless of program type.
  amount: z.number().positive().max(100_000).optional(),
});
export type ScanInput = z.infer<typeof ScanInput>;

// Discriminated union: "applied" = something happened, "needs_amount" = the
// scanner UI needs to collect the bill amount from the merchant before
// re-calling scan with action='add-points'. Points cards on action='auto'
// always return needs_amount.
export const ScanResultApplied = z.object({
  status: z.literal("applied"),
  detail: CardDetail,
  appliedAction: z.enum(["stamp", "redeem", "add-points"]),
});
export type ScanResultApplied = z.infer<typeof ScanResultApplied>;

export const ScanResultNeedsAmount = z.object({
  status: z.literal("needs_amount"),
  cardId: z.string(),
  programType: z.literal("points"),
  customerName: z.string().nullable(),
  programName: z.string(),
  rewardText: z.string(),
  currentBalance: z.number().int().nonnegative(),
  pointsForReward: z.number().int().positive(),
  pointsPerEuro: z.number().positive(),
  // True when currentBalance >= pointsForReward, so the UI can show a
  // "Redeem reward" button alongside the "Add transaction" input.
  eligibleToRedeem: z.boolean(),
});
export type ScanResultNeedsAmount = z.infer<typeof ScanResultNeedsAmount>;

export const ScanResult = z.discriminatedUnion("status", [
  ScanResultApplied,
  ScanResultNeedsAmount,
]);
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

// ---------- Card design ----------
//
// Stored in loyalty_programs.config_json.design — no migration, per the
// polymorphic-config convention in CLAUDE.md. Every field is optional: a
// PATCH sends only what changed, and the renderer fills the rest from
// DEFAULT_CARD_DESIGN.
//
// Colours are validated here rather than only at render time so a bad value
// is rejected at the API boundary instead of silently falling back.
const HEX_COLOR = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "must be a hex colour like #14271C");

export const CardDesignInput = z.object({
  backgroundColor: HEX_COLOR.optional(),
  foregroundColor: HEX_COLOR.optional(),
  labelColor: HEX_COLOR.optional(),
  stampIcon: z.enum(STAMP_ICON_IDS).optional(),
  stampFilledColor: HEX_COLOR.optional(),
  stampEmptyColor: HEX_COLOR.optional(),
  badgeStyle: z.enum(["filled", "outline", "bare"]).optional(),
  pattern: z.enum(["icon-tile"]).nullable().optional(),
  patternOpacity: z.number().min(0).max(1).optional(),
  titleText: z.string().max(60).optional(),
  progressLabel: z.string().max(40).optional(),
  rewardsLabel: z.string().max(40).optional(),
});
export type CardDesignInput = z.infer<typeof CardDesignInput>;

// Customer-facing read of their own card. Sanitised — only the customer's
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
  // Per-program visual design (loyalty_programs.config_json.design). Null when
  // the merchant has not customised the card — the renderer falls back to
  // DEFAULT_CARD_DESIGN plus the merchant brand colour.
  design: CardDesignInput.nullable().optional(),
});
export type PublicCardView = z.infer<typeof PublicCardView>;

export const RfmSegment = z.enum([
  "champions", // recent and frequent — ask these people for a Google review
  "promising", // recent, a few visits — nudge toward becoming regulars
  "new", // recent first visit — visit two is where loyalty sticks or dies
  "at_risk", // used to come often, gone quiet — the win-back money
  "sleeping", // occasional, gone quiet — cheap to re-engage, low expectation
  "lost", // long gone — stop spending attention here
]);
export type RfmSegment = z.infer<typeof RfmSegment>;

// ---------- Messaging (broadcasts + sweeps) ----------

export const AudienceFilter = z.object({
  // Send only to cards where total_lifetime stamps is at least this number.
  minLifetimeStamps: z.number().int().nonnegative().max(10000).optional(),
  // Send only to customers whose birthday month matches the current
  // server-side calendar month.
  withBirthdayThisMonth: z.boolean().optional(),
  // Send only to cards under this specific program id (must belong to merchant).
  programId: z.string().optional(),
  // Send only to customers currently in this RFM segment. This is the point of
  // segmentation: "message the 20 people about to churn" instead of all 200.
  rfmSegment: RfmSegment.optional(),
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

// ---------- Analytics (Day 15) ----------

// One row of the Overview page's activity feed. Reads straight from
// card_events rather than being inferred from loyalty_cards.last_event_at,
// so a card stamped three times today shows as three entries and each one
// carries its own sale amount.
export const ActivityEvent = z.object({
  id: z.number(),
  cardId: z.string(),
  customerName: z.string().nullable(),
  programName: z.string(),
  eventType: CardEvent.shape.eventType,
  amountCents: z.number().int().nonnegative().nullable(),
  createdAt: z.string(),
});
export type ActivityEvent = z.infer<typeof ActivityEvent>;

// Payload for GET /v1/analytics/overview.
//
// Revenue and AOV cover only events that actually carried an amount. If a
// merchant skips the amount prompt on half their scans, `transactions` counts
// the half that were captured — otherwise AOV would be revenue divided by
// every scan, which understates the real basket size.
export const AnalyticsOverview = z.object({
  currencyCode: z.string().length(3),
  // Rolling windows, both anchored on now() rather than calendar boundaries.
  revenueCents7d: z.number().int().nonnegative(),
  revenueCents30d: z.number().int().nonnegative(),
  // Count of amount-carrying events in the last 7 days — the AOV denominator.
  transactions7d: z.number().int().nonnegative(),
  // Null when transactions7d is 0: there is no average of nothing, and the UI
  // should render a dash instead of a misleading €0.00.
  aovCents7d: z.number().int().nonnegative().nullable(),
  recentEvents: z.array(ActivityEvent),
});
export type AnalyticsOverview = z.infer<typeof AnalyticsOverview>;

// ---------- Analytics detail (Day 17) ----------

export const AnalyticsRange = z.enum(["7d", "30d", "90d", "12m"]);
export type AnalyticsRange = z.infer<typeof AnalyticsRange>;

// One point on the trend charts. `date` is a calendar date in the MERCHANT's
// timezone, not UTC — a stamp at 00:30 in Amsterdam is 22:30 UTC the previous
// day, and bucketing that into the wrong day is the kind of error nobody
// notices because the chart still looks plausible.
export const AnalyticsDayBucket = z.object({
  date: z.string(), // YYYY-MM-DD, merchant-local
  visits: z.number().int().nonnegative(),
  revenueCents: z.number().int().nonnegative(),
});
export type AnalyticsDayBucket = z.infer<typeof AnalyticsDayBucket>;

// Busiest-hours histogram. Always 24 entries, 0..23, merchant-local, so the
// UI can render a fixed axis without filling gaps itself.
export const AnalyticsHourBucket = z.object({
  hour: z.number().int().min(0).max(23),
  visits: z.number().int().nonnegative(),
});
export type AnalyticsHourBucket = z.infer<typeof AnalyticsHourBucket>;

export const AnalyticsTopMember = z.object({
  cardId: z.string(),
  customerName: z.string().nullable(),
  visits: z.number().int().nonnegative(),
  revenueCents: z.number().int().nonnegative(),
});
export type AnalyticsTopMember = z.infer<typeof AnalyticsTopMember>;

// Payload for GET /v1/analytics/detail?range=…
//
// "Visits" means stamp + points_add events: the moments a customer actually
// came in and transacted. Deliberately excludes signup (joining is not a
// visit) and expire (a cron, not a person).
export const AnalyticsDetail = z.object({
  range: AnalyticsRange,
  // Echoed back so the UI can label axes honestly rather than assuming the
  // viewer's own timezone matches the merchant's.
  timezone: z.string(),
  currencyCode: z.string().length(3),
  series: z.array(AnalyticsDayBucket),
  hours: z.array(AnalyticsHourBucket),
  // A card counts as "returning" when it has more than one visit INSIDE the
  // selected range. A long-standing customer with a single visit this week is
  // new-to-this-period, which is what the chart is actually asking.
  newCards: z.number().int().nonnegative(),
  returningCards: z.number().int().nonnegative(),
  topByVisits: z.array(AnalyticsTopMember),
  topByRevenue: z.array(AnalyticsTopMember),
  totalVisits: z.number().int().nonnegative(),
  totalRevenueCents: z.number().int().nonnegative(),
  // Null rather than 0 when nothing was captured — same reasoning as
  // AnalyticsOverview.aovCents7d.
  aovCents: z.number().int().nonnegative().nullable(),
});
export type AnalyticsDetail = z.infer<typeof AnalyticsDetail>;

// ---------- Marketing site leads (Day 18) ----------

export const LeadSource = z.enum(["demo", "newsletter"]);
export type LeadSource = z.infer<typeof LeadSource>;

// Body for POST /v1/public/leads.
//
// Only `source` and `email` are required: the newsletter form collects nothing
// else, and a half-filled demo form is still a lead worth keeping. Validation
// that rejects a real prospect is worse than a row with null columns.
export const LeadInput = z.object({
  source: LeadSource,
  email: z.string().email().max(200),
  name: z.string().max(200).optional(),
  phone: z.string().max(40).optional(),
  businessName: z.string().max(200).optional(),
  businessType: z.string().max(100).optional(),
  message: z.string().max(5000).optional(),
  referer: z.string().max(500).optional(),
  // Honeypot. Hidden in the markup, so a human never fills it and a bot that
  // fills every input does. A filled value is answered 200 and dropped — a
  // visible rejection just teaches the bot to try again.
  website: z.string().max(200).optional(),
});
export type LeadInput = z.infer<typeof LeadInput>;

export const LeadResult = z.object({ ok: z.boolean() });
export type LeadResult = z.infer<typeof LeadResult>;

// ---------- Customer CSV import / export (Day 19) ----------

export const CustomerImportInput = z.object({
  // Raw CSV text. The browser reads the file and posts its contents, which
  // avoids multipart handling in an api that has none.
  csv: z.string().min(1).max(2_000_000),
  // Preview without writing. A café importing its only customer list should
  // be able to see what will happen before it happens.
  dryRun: z.boolean().optional().default(false),
  // Optionally enrol every imported customer on this program. Deliberately
  // does NOT send invite emails: importing 200 customers would hit Resend's
  // 100/day cap and silently deliver half.
  programId: z.string().uuid().optional(),
});
export type CustomerImportInput = z.infer<typeof CustomerImportInput>;

export const CustomerImportRowError = z.object({
  // 1-based, counting the header as line 1, so it matches what the merchant
  // sees in their spreadsheet.
  line: z.number().int().positive(),
  reason: z.string(),
});
export type CustomerImportRowError = z.infer<typeof CustomerImportRowError>;

export const CustomerImportResult = z.object({
  dryRun: z.boolean(),
  // Which separator was detected — worth surfacing, since a misdetection is
  // the most likely cause of a file that "imports" as one giant column.
  delimiter: z.string(),
  totalRows: z.number().int().nonnegative(),
  created: z.number().int().nonnegative(),
  enrolled: z.number().int().nonnegative(),
  // Matched an existing customer by email or phone and were left alone.
  duplicates: z.number().int().nonnegative(),
  skipped: z.array(CustomerImportRowError),
});
export type CustomerImportResult = z.infer<typeof CustomerImportResult>;

// ---------- RFM segments (Day 20) ----------
//
// Recency / Frequency / Monetary, reduced to something a café with 60
// customers can act on.
//
// Classic RFM scores each dimension into quintiles and crosses them into 125
// cells. That needs a population large enough for quintiles to mean anything;
// on 60 customers it produces buckets of 12 and invents precision. Perkstar
// ships 9 segments for the same reason it ships 100 templates — scale we do
// not have yet.
//
// So: threshold-based, six segments, each with an obvious next action. R and F
// decide the segment; M is reported alongside because "which of these is worth
// most" is the follow-up question, not part of the classification.

export const RfmThresholds = z.object({
  // "Came in recently" — within this many days.
  recentDays: z.number().int().positive().max(365),
  // Beyond this many days a customer is written off as lost.
  lapsedDays: z.number().int().positive().max(1095),
  // Visits that make someone a regular rather than an occasional.
  frequentVisits: z.number().int().positive().max(1000),
});
export type RfmThresholds = z.infer<typeof RfmThresholds>;

// Tuned for a café: monthly-ish visits, a quarter before you give up. A barber
// or a gym would want different numbers, which is why these are a parameter
// and not constants buried in a query.
export const DEFAULT_RFM_THRESHOLDS: RfmThresholds = {
  recentDays: 30,
  lapsedDays: 90,
  frequentVisits: 5,
};

/**
 * Classify one customer. Pure, so the API and the dashboard cannot drift on
 * what "at risk" means — the same reason the card renderer lives in shared.
 *
 * Order matters: lapsed is checked first, so someone who used to visit daily
 * but has not appeared in six months is `lost`, not `champions`.
 */
export function classifyRfm(
  daysSinceLastVisit: number,
  visits: number,
  thresholds: RfmThresholds = DEFAULT_RFM_THRESHOLDS
): RfmSegment {
  if (daysSinceLastVisit > thresholds.lapsedDays) return "lost";

  if (daysSinceLastVisit <= thresholds.recentDays) {
    if (visits >= thresholds.frequentVisits) return "champions";
    return visits >= 2 ? "promising" : "new";
  }

  // Quiet, but not yet written off. Whether that is worth chasing depends
  // entirely on whether they used to be a regular.
  return visits >= thresholds.frequentVisits ? "at_risk" : "sleeping";
}

export const RfmSegmentSummary = z.object({
  segment: RfmSegment,
  customers: z.number().int().nonnegative(),
  // Lifetime captured spend for the segment. Null-amount events are excluded,
  // same rule as everywhere else: a skipped prompt is not a zero sale.
  revenueCents: z.number().int().nonnegative(),
});
export type RfmSegmentSummary = z.infer<typeof RfmSegmentSummary>;

export const RfmOverview = z.object({
  thresholds: RfmThresholds,
  currencyCode: z.string().length(3),
  // Always all six, in a fixed order, so the UI renders a stable layout
  // instead of reflowing as buckets empty and fill.
  segments: z.array(RfmSegmentSummary),
  // Customers with at least one visit. Someone enrolled but never stamped has
  // no recency to measure and is deliberately not forced into a bucket.
  totalClassified: z.number().int().nonnegative(),
});
export type RfmOverview = z.infer<typeof RfmOverview>;
