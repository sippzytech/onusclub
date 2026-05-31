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

export type CardStatus = "active" | "blocked";
export type MerchantStatus = "active" | "suspended" | "trial";
export type StaffRole = "owner" | "staff";

// Program-type-specific config shapes. Stored as JSON in loyalty_programs.config_json.
// Add new variants here when introducing new program types — no DB migration needed.
export interface StampProgramConfig {
  type: "stamp";
  stamps_required: number;
}

export interface PointsProgramConfig {
  type: "points";
  points_per_currency: number;
  expiry_days?: number;
}

export type ProgramConfig = StampProgramConfig | PointsProgramConfig;

// Program-type-specific runtime state. Stored as JSON in loyalty_cards.card_state.
export interface StampCardState {
  type: "stamp";
  stamps_current: number;
  total_lifetime: number;
  rewards_redeemed: number;
}

export interface PointsCardState {
  type: "points";
  balance: number;
  lifetime_earned: number;
}

export type CardState = StampCardState | PointsCardState;

export interface HealthResponse {
  ok: boolean;
  service: string;
  version: string;
}

export * from "./contracts.js";
