-- Link a staff_users row to a Google account.
--
-- WHY A COLUMN AND NOT JUST THE EMAIL
--
-- Sign-in matches on the verified email first, because that is what lets an
-- owner who signed up with a password later use the Google button on the same
-- account. But the email is not a stable identifier: a Google account can
-- change its address, and a Workspace account can be renamed by its admin.
-- Matching on email alone would silently turn one such change into "no account
-- found", and the owner would be invited to create a second café.
--
-- `sub` is Google's own immutable subject id for the account. Written on the
-- first successful Google sign-in, and preferred over the email on every one
-- after that.
--
-- WHY NULLABLE
--
-- Every existing owner has none, and most never will — the password flow is
-- staying. This is a second door onto the same account, not a migration of
-- anyone onto Google.
--
-- WHY UNIQUE
--
-- One Google account must not be attached to two logins. Without the
-- constraint, a bug that wrote the same `sub` twice would make "find the user
-- for this Google account" ambiguous, and which café you landed in would
-- depend on row order. MySQL permits multiple NULLs in a UNIQUE index, which
-- is exactly the behaviour wanted here.
--
-- Length: Google documents `sub` as at most 255 ASCII characters. Real values
-- are 21-digit numeric strings today, but the column is sized to the
-- documented maximum rather than the observed one.

ALTER TABLE staff_users
  ADD COLUMN google_sub VARCHAR(255) NULL,
  ADD UNIQUE KEY uq_staff_users_google_sub (google_sub);
