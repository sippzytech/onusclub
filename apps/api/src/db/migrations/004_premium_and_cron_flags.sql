-- Phase-1 monetisation gate: the Messages feature (broadcasts + birthday +
-- inactivity sweeps + dashboards) is premium-only. Default FALSE — existing
-- merchants land on the locked screen until they upgrade.
ALTER TABLE merchants
  ADD COLUMN is_premium BOOLEAN NOT NULL DEFAULT FALSE AFTER status;

-- Per-merchant kill-switch for the daily cron sweeps. Even premium merchants
-- can pause automated notifications without losing access to broadcasts. The
-- cron queries enforce both this AND is_premium.
ALTER TABLE merchants
  ADD COLUMN crons_enabled BOOLEAN NOT NULL DEFAULT TRUE AFTER is_premium;
