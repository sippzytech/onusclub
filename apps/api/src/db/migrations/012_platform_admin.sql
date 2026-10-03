-- Platform administration: the one role that deliberately sees across tenants.
--
-- Every other query in this codebase carries `WHERE merchant_id = ?`. The
-- master dashboard is the single exception, which makes who may use it the
-- most security-relevant decision in the schema.
--
-- WHY A TABLE AND NOT A ROLE ON staff_users
--
-- The obvious shape — add 'superadmin' to staff_users.role — is wrong here for
-- three reasons, all of them properties of code that exists today:
--
--  1. `role` travels inside the JWT (apps/api/src/auth/jwt.ts), which has a
--     7-day expiry and no denylist. Revoking platform access would take a
--     week to take effect.
--  2. verifyJwt validated `userId` and `merchantId` and never `role`, so a
--     token minted with role: "superadmin" would have passed verification.
--     (That hole is closed in the same commit as this migration — but the
--     lesson is that a privilege living in a bearer token is only as strong as
--     the weakest thing that mints one.)
--  3. POST /v1/staff hardcodes 'staff' today, but the moment merchants can
--     choose their staff's role, an enum value is exactly what an attacker
--     asks for. A separate table is not reachable from any merchant-facing
--     write path, whatever that endpoint grows into.
--
-- So: membership is a row here, checked against the database on every
-- /v1/admin/* request rather than read from the token. DELETE revokes
-- instantly, mid-session, without waiting for a JWT to expire.
--
-- HOW TO GRANT (SQL only — there is deliberately no API or UI for this, and a
-- CI check asserts that `platform_admins` is named nowhere in src/ except the
-- authorize module that reads it):
--
--   INSERT INTO platform_admins (staff_user_id, note)
--   SELECT id, 'founder' FROM staff_users WHERE email = 'you@example.com';
--
-- To revoke:
--
--   DELETE FROM platform_admins WHERE staff_user_id = '...';
--
-- See docs/admin/README.md.

CREATE TABLE platform_admins (
  -- Points at an ordinary staff_users row: a platform admin logs in through
  -- the normal login form with a normal password, and still belongs to their
  -- own merchant. This grants an extra capability; it does not create a
  -- second kind of account with its own credential path to get wrong.
  staff_user_id VARCHAR(36) PRIMARY KEY,

  -- Free text: who this is and why they have it. Read by humans during an
  -- audit, six months from now, when nobody remembers.
  note          VARCHAR(200),

  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- ON DELETE CASCADE matters: deleting a staff account (or the merchant it
  -- belongs to) must not leave a dangling grant that a recycled id could
  -- inherit. ids are UUIDs so collision is not the real risk — an orphaned
  -- row that looks like a live grant in an audit is.
  FOREIGN KEY (staff_user_id) REFERENCES staff_users(id) ON DELETE CASCADE
);

-- Append-only record of every write made through the admin surface.
--
-- card_events already records balance adjustments, and crucially records them
-- where the *merchant* can see them — that is the honesty layer. This is the
-- operator-side layer: it covers writes that have no card to attach to
-- (suspending a merchant, changing a fee, forcing a password reset) and it
-- carries the before/after of each one.
--
-- Written inside the same transaction as the change it describes, so a
-- mutation that forgets to audit itself cannot commit.
CREATE TABLE admin_audit_log (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,

  -- Who. No FK: the log must outlive the account, otherwise deleting a staff
  -- user would erase the evidence of what they did.
  actor_user_id VARCHAR(36) NOT NULL,
  actor_email   VARCHAR(200) NOT NULL,

  -- What: 'card.adjust', 'merchant.update', 'merchant.password_reset'.
  -- A string rather than an ENUM so adding an action is not a migration.
  action        VARCHAR(50) NOT NULL,

  -- Which tenant it landed on, and which row. Both nullable because not every
  -- action has both. Deliberately no FK, same reason as the actor: the log
  -- outlives what it describes, and a cascade here would delete the record of
  -- a deletion.
  merchant_id   VARCHAR(36),
  target_type   VARCHAR(30),
  target_id     VARCHAR(64),

  -- Required at the application layer, min 3 chars. An adjustment without a
  -- stated reason is indistinguishable from a mistake.
  reason        VARCHAR(500) NOT NULL,

  -- Before/after of whatever changed, shaped per action. JSON because the
  -- shape differs by action and the alternative is a column per field.
  before_json   JSON,
  after_json    JSON,

  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- "What was done to this café" — the question actually asked when a
  -- merchant complains their numbers moved.
  INDEX (merchant_id, created_at),
  INDEX (created_at)
);

-- What this café agreed to pay us per month, in cents.
--
-- Nothing in the system knows our prices: there is no plan table and no
-- billing integration (Stripe is deferred to ROADMAP item 9). Until there is,
-- the only honest source for "what are we earning" is the operator typing in
-- what each café agreed to.
--
-- NULL means "not set", and renders as "—" rather than €0 — a café on a free
-- pilot and a café whose fee nobody has recorded are different facts, and
-- collapsing them to zero would quietly understate revenue. When Stripe lands
-- this column becomes the fallback for merchants without a subscription.
ALTER TABLE merchants
  ADD COLUMN monthly_fee_cents INT NULL DEFAULT NULL AFTER trial_ends_at;
