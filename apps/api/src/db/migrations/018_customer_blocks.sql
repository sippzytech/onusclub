-- Customers a café (or the platform) will not serve again.
--
-- WHY THIS EXISTS
--
-- Until now a café had no action at all against a customer behaving badly.
-- `loyalty_cards.status` has had a 'blocked' value since migration 001 —
-- `applyStamp`, `applyRedeem` and the scan path all refuse a non-active card,
-- and /c/[qrToken] renders "This card is blocked" — but nothing in the product
-- ever wrote it. This migration is the half that was missing.
--
-- REMOVE vs BLOCK
--
--   Remove  deletes the `customers` row; the FK cascade clears their cards,
--           events and points batches. They can enrol again from zero. That is
--           the point: a fresh start.
--   Block   sets their cards to 'blocked' AND writes a row here, so enrolling
--           again is refused. The card status stops the pass working today;
--           this table stops them coming back tomorrow. Either one alone is
--           half a feature.
--
-- WHY HASHES AND NOT ADDRESSES
--
-- 🚨 This row has to outlive every café that ever knew the person — that is
-- the entire point of a block list, and it is why there is no foreign key to
-- `merchants` here. A table of names, emails and phone numbers belonging to
-- people whose café no longer exists is a profile we would have no business
-- holding, and no lawful basis to keep once the relationship that justified
-- collecting it is gone.
--
-- So: a one-way HMAC of the normalised identifier, which is enough to answer
-- "is this person blocked?" at enrolment and nothing else. `display_hint` is a
-- masked fragment so an admin can recognise a row they created; it is
-- deliberately not a contact detail.
--
-- ⚠️ TWO THINGS ABOUT THE PEPPER
--
-- `BLOCKLIST_PEPPER` keys the HMAC. Empty is allowed and the feature still
-- works, but the hash is then a plain SHA-256 of an email — unreadable at a
-- glance, yet cheap to confirm for an address you already suspect. Set it in
-- production.
--
-- 🚨 ROTATING THE PEPPER SILENTLY UNBLOCKS EVERYONE. No stored hash will match
-- again, no error is raised, and the first anyone notices is a blocked
-- customer walking back in. Treat it as permanent, or re-collect the blocks.

CREATE TABLE customer_blocks (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,

  -- Which café. NULL means platform-wide, which only a platform admin may
  -- write. No FK, deliberately: a café-scoped block must survive that café
  -- being deleted, and a platform block must survive all of them.
  merchant_id   VARCHAR(36) NULL,

  -- HMAC-SHA256 of the lower-cased, trimmed email / digits-only phone.
  -- Either may be null — we block on whichever identifiers we had.
  email_hash    CHAR(64) NULL,
  phone_hash    CHAR(64) NULL,

  -- "j•••@gmail.com" or "•••• 1234". Enough to recognise, not to contact.
  display_hint  VARCHAR(60) NOT NULL,

  -- Required. A block with no stated reason is one nobody can review later.
  reason        VARCHAR(500) NOT NULL,

  -- Denormalised like admin_audit_log, and for the same reason: no FK, so the
  -- record still names someone after their account is gone.
  actor_user_id VARCHAR(36) NOT NULL,
  actor_email   VARCHAR(200) NOT NULL,

  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- The enrolment lookup: "is this hash blocked at this café, or globally?"
  INDEX (merchant_id, email_hash),
  INDEX (merchant_id, phone_hash),
  -- Platform-wide blocks are scanned on every enrolment too.
  INDEX (email_hash),
  INDEX (phone_hash)
);
