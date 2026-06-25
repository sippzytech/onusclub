-- Day 14: points-type loyalty programs with per-batch expiry.
--
-- Stamp programs and points programs share the same `loyalty_programs` and
-- `loyalty_cards` tables — the polymorphism lives in JSON columns:
--
--   loyalty_programs.program_type:
--     - 'stamp'  → config_json: { stamps_required, expiry_days? }
--     - 'points' → config_json: { points_per_euro, points_for_reward,
--                                 batch_expiry_days? }
--
--   loyalty_cards.card_state:
--     - { type: 'stamp',  stamps_current, total_lifetime, rewards_redeemed }
--     - { type: 'points', points_current, total_lifetime, rewards_redeemed,
--                         total_expired }
--
-- This migration only adds the new ledger table — no DDL on existing tables,
-- since `program_type` and `card_state` are already polymorphic JSON.
--
-- Points programs need per-batch expiry (Starbucks-style): each "add points"
-- transaction creates a row here with its own expires_at timer. Redemptions
-- deduct FIFO from oldest non-expired batches. Daily cron sweeps batches
-- whose expires_at just passed and zeroes them out, then patches the wallet.
--
-- Stamp programs do not write to this table; they use the existing card-level
-- expiry mechanism on loyalty_cards.last_event_at + program.expiry_days.

CREATE TABLE points_batches (
  id CHAR(36) NOT NULL,
  card_id CHAR(36) NOT NULL,
  merchant_id CHAR(36) NOT NULL,
  points_earned INT UNSIGNED NOT NULL,
  -- Drops as redemptions deduct from this batch. Hits 0 when fully used or
  -- when the daily cron sweeps it after expiry. The card's displayed balance
  -- is SUM(points_remaining) across non-expired rows for that card.
  points_remaining INT UNSIGNED NOT NULL,
  earned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- NULL = never expires (program has expiry toggle off).
  expires_at DATETIME NULL,
  PRIMARY KEY (id),
  -- The hot read path: "find non-expired batches for this card, oldest first"
  -- for both balance queries and FIFO redemption.
  KEY idx_card_earned (card_id, earned_at),
  -- The expiry-sweep cron scans across all merchants by expires_at.
  KEY idx_expires (expires_at),
  CONSTRAINT fk_points_batches_card FOREIGN KEY (card_id) REFERENCES loyalty_cards(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
