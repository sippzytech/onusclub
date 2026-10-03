-- Per-merchant trial expiry.
--
-- `merchants.status` has carried a 'trial' value since 001 and every merchant
-- is created with it, but nothing ever recorded when that trial should end, so
-- the status meant nothing. This gives it a date.
--
-- NULL is deliberate and means "no trial clock" — an unlimited account. That
-- is the right default for the rows that already exist: they predate trials
-- and must not be retroactively expired. New signups get a date set at
-- creation from TRIAL_DAYS_DEFAULT.
--
-- Length is per-merchant rather than global on purpose. The default applies to
-- everyone, and a specific merchant can be extended without touching anyone
-- else. Until the master dashboard (ROADMAP items 10-13) exists this is driven
-- by SQL:
--
--   -- give one merchant another 30 days from now
--   UPDATE merchants SET trial_ends_at = NOW() + INTERVAL 30 DAY WHERE id = '...';
--
--   -- extend everyone currently on trial by 14 days
--   UPDATE merchants SET trial_ends_at = trial_ends_at + INTERVAL 14 DAY
--    WHERE status = 'trial' AND trial_ends_at IS NOT NULL;
--
--   -- take a merchant off the clock entirely
--   UPDATE merchants SET trial_ends_at = NULL, status = 'active' WHERE id = '...';

ALTER TABLE merchants
  ADD COLUMN trial_ends_at TIMESTAMP NULL DEFAULT NULL AFTER status;

-- Supports "which trials are ending soon" without a full scan once there are
-- enough merchants for that to matter.
CREATE INDEX idx_merchants_trial_ends_at ON merchants (trial_ends_at);
