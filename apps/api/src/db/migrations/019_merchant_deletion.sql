-- Deleting a café: the tombstone it leaves, and the code that gates it.
--
-- WHY A DELETE AT ALL
--
-- `routes/admin/merchants.ts` has said since Day 23: "There is deliberately no
-- DELETE. The cascade from `merchants` reaches customers, cards, events and
-- points batches, and is irreversible — while `status = 'suspended'` covers
-- every real need and can be undone."
--
-- That was right when a bare DELETE was the only alternative. It is overruled
-- deliberately, and replaced with something narrower: a delete that leaves a
-- record of itself, is gated behind a code, and cannot take the platform's own
-- administrators down with it.
--
-- WHY HARD DELETE AND NOT status = 'deleted'
--
-- `merchants.owner_email` is UNIQUE. A soft-deleted café keeps its row, so the
-- owner could never sign up again without extra release logic — and every
-- query that filters on `status` would have to learn a new value or deleted
-- cafés would leak into dashboards, metrics and sweeps. Hard delete frees the
-- email for free and cannot leak anywhere.
--
-- WHAT SURVIVES, AND WHY THAT IS CORRECT
--
-- The cascade reaches locations, programs, customers, cards, events, points
-- batches, message deliveries, apple registrations, broadcasts and assets.
-- These do NOT have a foreign key to `merchants`, on purpose, and so survive:
--
--   admin_audit_log   the record of the deletion itself
--   customer_blocks   a block must outlive the café that made it
--   email_deliveries  "did my customer get their card?" outlives the account
--   ai_drafts         a bill does not disappear because the café did
--
-- 🚨 ONE THING THE CASCADE REACHES THAT IT SHOULD NOT
--
-- `platform_admins.staff_user_id` cascades from `staff_users`, which cascades
-- from `merchants`. So deleting a café silently REVOKES PLATFORM ADMIN from
-- anyone whose staff account lives in it — including, very plausibly, the
-- person doing the deleting. Granting admin is SQL-only, so they would lock
-- themselves out of /admin with no way back in through the product.
--
-- The delete endpoint refuses in that case rather than relying on care.

CREATE TABLE deleted_merchants (
  -- The old merchant id, so audit rows and block rows that reference it can
  -- still be resolved to a name.
  id            VARCHAR(36) PRIMARY KEY,

  -- Kept so the cross-café customer view can say "(café discontinued)"
  -- instead of showing a dangling id. The business name of a company is not
  -- personal data; nothing else about the café is retained.
  business_name VARCHAR(200) NOT NULL,

  deleted_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  actor_email   VARCHAR(200) NOT NULL,
  reason        VARCHAR(500) NOT NULL
);

-- Small key/value store so adding a platform setting is not a migration.
-- Deliberately not a column-per-setting table: the next three settings would
-- each be a schema change, and this is configuration, not a domain model.
CREATE TABLE platform_settings (
  setting_key   VARCHAR(50) PRIMARY KEY,
  setting_value VARCHAR(200) NOT NULL,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- The café-deletion confirmation code, bcrypt-hashed exactly like a password.
--
-- Stored hashed rather than in plaintext because anyone with read access to
-- this table would otherwise hold the one thing standing between a mistake and
-- an irreversible cascade. The value seeded here is '1234', agreed as a
-- starting point; it is changeable from /admin.
--
-- ⚠️ A shared static code proves intent, not identity. It guards against a
-- misclick, not against someone who already has platform-admin access — they
-- are inside the gate by definition. Attempts are rate-limited so it cannot be
-- ground out by a process that somehow reaches the endpoint without it.
INSERT INTO platform_settings (setting_key, setting_value) VALUES
  ('delete_confirmation_code', '$2a$10$J58T5pIx4LykzFeGinsYOOWB1MDFFppAhOQ2VU0FyPLZW6ZDpfnaC');
