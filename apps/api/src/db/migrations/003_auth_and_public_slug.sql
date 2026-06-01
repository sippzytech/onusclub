-- Password auth for owners (replaces magic-link as the primary auth path).
-- VARBINARY(255) is enough for any bcrypt/argon2 hash we might use.
ALTER TABLE staff_users
  ADD COLUMN password_hash VARBINARY(255) NULL AFTER role;

-- Public slug for each merchant — used in the customer-facing QR signup URL
-- (https://app.sippzy.com/m/<slug>). Nullable so we can add the column safely
-- to a table that may already contain rows; signup always fills it in for new
-- merchants. The api also has a startup backfill that assigns slugs to any
-- pre-existing rows that don't have one.
ALTER TABLE merchants
  ADD COLUMN public_slug VARCHAR(80) NULL AFTER status;

-- MySQL allows multiple NULL values under a UNIQUE index — that's exactly what
-- we want during the brief backfill window.
ALTER TABLE merchants
  ADD UNIQUE INDEX merchants_public_slug_idx (public_slug);
