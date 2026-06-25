export type ProgramType =
  | "stamp"
  | "points"
  | "membership"
  | "multipass"
  | "discount"
  | "cashback"
  | "gift"
  | "coupon";

export type EventType =
  | "stamp"
  | "redeem"
  | "reset"
  | "manual_adjust"
  | "points_add"
  | "review_reward"
  | "signup"
  | "expire";

export type CardStatus = "active" | "blocked" | "expired";
export type MerchantStatus = "active" | "suspended" | "trial";
export type StaffRole = "owner" | "staff";

// Program-type-specific config shapes. Stored as JSON in loyalty_programs.config_json.
// Add new variants here when introducing new program types — no DB migration needed.
export interface StampProgramConfig {
  type: "stamp";
  stamps_required: number;
  // Card-level expiry (Day 9). Whole card moves to status='expired' after
  // last_event_at + expiry_days. Optional — omit for "never expires".
  expiry_days?: number;
}

export interface PointsProgramConfig {
  type: "points";
  // 1 euro spent → N points. Defaults to 1 in the create form but merchants
  // can crank it up (e.g. 10) to make the numbers feel bigger psychologically.
  points_per_euro: number;
  // Threshold for the reward. 1000 = "1000 points = free coffee".
  points_for_reward: number;
  // Per-batch expiry (Starbucks-style). Each "add points" transaction creates
  // a batch row whose expires_at = NOW() + batch_expiry_days. Daily cron
  // zeroes batches whose expires_at has passed. Optional — omit for no
  // per-batch expiry.
  batch_expiry_days?: number;
}

export type ProgramConfig = StampProgramConfig | PointsProgramConfig;

// Program-type-specific runtime state. Stored as JSON in loyalty_cards.card_state.
// `total_lifetime` and `rewards_redeemed` are common to all types so the
// dashboard can show consistent "lifetime stats" without switching on type.
export interface StampCardState {
  type: "stamp";
  stamps_current: number;
  total_lifetime: number;
  rewards_redeemed: number;
}

export interface PointsCardState {
  type: "points";
  points_current: number;          // = SUM(points_remaining) across non-expired batches
  total_lifetime: number;          // every point ever earned (incl. expired / redeemed)
  rewards_redeemed: number;        // count of times the threshold was hit
  total_expired: number;           // for analytics / customer messaging
}

export type CardState = StampCardState | PointsCardState;

export interface HealthResponse {
  ok: boolean;
  service: string;
  version: string;
}

export * from "./contracts.js";
