-- Every email the system tries to send, and what happened to it.
--
-- WHY THIS EXISTS
--
-- Until now a failed send was a single `logger.error` line and nothing else.
-- No counter, no dashboard, no record. The scenario that matters: a café's
-- customer says "I never got my card", and the only way to answer was to SSH
-- into the box and grep container logs — assuming they had not rotated.
--
-- Resend's free tier caps at 100/day, which binds long before the 3,000/month
-- headline. Email volume tracks signups, so the realistic failure is a café's
-- launch day: 150 people scan the QR, the last 50 get a card and no email. It
-- degrades rather than breaks (the card is created either way and the customer
-- is already on the card page) but nobody finds out, and the café concludes
-- the product is broken.
--
-- WHY NOT `message_deliveries`
--
-- That table is for wallet pushes — broadcast, birthday and inactivity — and
-- is card-scoped with a NOT NULL foreign key to loyalty_cards. Magic links,
-- password resets and the lead notification to ourselves have no card, so they
-- cannot go in it. Different thing, different table.

CREATE TABLE email_deliveries (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,

  -- What this email was. A string rather than an ENUM so adding a kind is not
  -- a migration: 'card_invite', 'magic_link', 'password_reset',
  -- 'admin_password_reset', 'lead_notification', 'weekly_digest'.
  kind          VARCHAR(40) NOT NULL,

  -- Who it concerns. NULL for the lead notification, which goes to us and
  -- belongs to no tenant. No FK on merchant_id so the record outlives a
  -- deleted account — the same reasoning as admin_audit_log.
  merchant_id   VARCHAR(36) NULL,
  -- Set for card invites, so a café can answer "did this customer get it?"
  -- without us. Nullable and FK-less for the same reason.
  customer_id   VARCHAR(36) NULL,
  card_id       VARCHAR(36) NULL,

  to_email      VARCHAR(200) NOT NULL,
  subject       VARCHAR(300) NOT NULL,

  -- 'sent'    Resend accepted it. Not proof of delivery — it can still bounce,
  --           and we do not consume Resend's webhooks (yet).
  -- 'failed'  Resend rejected it, or the request threw. `error` says why.
  -- 'skipped' No RESEND_API_KEY configured, so nothing was attempted. This is
  --           normal in local dev and must not be counted as a failure — the
  --           distinction is the whole reason there are three states and not a
  --           boolean.
  status        ENUM('sent','failed','skipped') NOT NULL,

  -- Resend's own id, so a specific message can be looked up in their
  -- dashboard. Null when skipped or failed.
  provider_id   VARCHAR(100) NULL,
  error         VARCHAR(500) NULL,

  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- "what failed for this café recently" — the question the dashboard asks.
  INDEX (merchant_id, status, created_at),
  -- "has this customer's invite ever landed" — the support question.
  INDEX (customer_id, created_at),
  -- Platform-wide email health for the admin dashboard.
  INDEX (status, created_at)
);
