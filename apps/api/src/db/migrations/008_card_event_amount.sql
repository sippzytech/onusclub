-- Day 15: revenue capture.
--
-- We do not integrate with any POS. Like Perkstar, the merchant optionally
-- types the sale amount at scan time, and every monetary number on the
-- dashboard (revenue, AOV, and later ROI / RFM) is derived from that single
-- input. See PERKSTAR_ANALYSIS.md for the reasoning.
--
-- Storage decision: integer minor units (cents) on the event, plus a currency
-- code on the merchant. Floats are wrong for money, and a per-merchant code
-- keeps the door open for non-euro markets without touching the event rows.
-- The API talks in euros (`amount`) because that is what a human types; the
-- conversion to cents happens once, at the write boundary.
--
-- NULL amount_cents means "no amount was captured for this event" — the
-- merchant skipped the prompt, or the event predates this migration. That is
-- deliberately distinct from 0, which would mean a genuine zero-value sale.
-- All aggregates must therefore filter on `amount_cents IS NOT NULL` rather
-- than relying on COALESCE, so skipped scans do not drag the AOV down.

ALTER TABLE card_events
  ADD COLUMN amount_cents BIGINT NULL AFTER delta_json;

ALTER TABLE merchants
  ADD COLUMN currency_code CHAR(3) NOT NULL DEFAULT 'EUR' AFTER country;

-- No new index: 001_initial already has INDEX (merchant_id, created_at) on
-- card_events, which is exactly the access path the overview aggregates use.

-- Backfill. Points programs (Day 14) have been capturing the bill amount all
-- along, but only inside delta_json.amount_euros where it cannot be summed
-- efficiently. Lift that history into the new column so the revenue numbers
-- are correct from the first render rather than starting at zero.
--
-- ROUND() before cast: amount_euros is a JSON number (double), so 12.34 * 100
-- can land on 1233.9999999999998, and a plain cast would truncate to 1233.
UPDATE card_events
   SET amount_cents = ROUND(JSON_EXTRACT(delta_json, '$.amount_euros') * 100)
 WHERE event_type = 'points_add'
   AND JSON_EXTRACT(delta_json, '$.amount_euros') IS NOT NULL;
