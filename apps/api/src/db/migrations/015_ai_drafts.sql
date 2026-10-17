-- Every AI campaign-draft request, and what it cost.
--
-- WHY THIS EXISTS
--
-- This is the first thing in the product that spends money per click on a
-- third-party API. Email has a free tier that simply stops at 100/day; wallet
-- pushes are free; the Anthropic API bills per token and keeps going. So the
-- failure mode is new: not an error, just an invoice nobody can explain.
--
-- With this table the question "what did drafting cost last month, and which
-- café caused it" is one query. Without it, the answer is grepping container
-- logs that rotate, which is exactly the hole email_deliveries was dug out of
-- on Day 25 — same lesson, applied before it bites instead of after.
--
-- It also catches abuse that the rate limiter permits but nobody wants: a
-- merchant pressing Draft forty times a day is inside 20/hour and still
-- costing more than they pay us.
--
-- WHAT IS DELIBERATELY NOT HERE
--
-- The drafts themselves. Storing generated copy would mean storing text that
-- was never sent, never approved and in most cases immediately discarded — and
-- then deciding how long to keep it. What was sent is already in `broadcasts`,
-- which is the record that matters. This table is a meter, not an archive.
--
-- Whether a draft was used. Linking a broadcast back to the draft it came from
-- would need the UI to carry an id through the composer and survive the
-- merchant editing the text until it is no longer that draft. The honest
-- version of that measurement does not exist yet, so the column does not
-- either.

CREATE TABLE ai_drafts (
  id            BIGINT AUTO_INCREMENT PRIMARY KEY,

  -- No FK, so the record outlives a deleted account — same reasoning as
  -- email_deliveries and admin_audit_log. A bill does not disappear because
  -- the café did.
  merchant_id   VARCHAR(36) NOT NULL,

  -- Which audience the copy was written for. NULL means "all active
  -- customers", which is a legitimate broadcast and not a missing value.
  -- VARCHAR rather than an ENUM mirroring RfmSegment: the segments are defined
  -- in packages/shared and adding one should not be a migration.
  rfm_segment   VARCHAR(20) NULL,

  language      VARCHAR(2) NOT NULL,

  -- Recorded per row rather than assumed, because the model will change and
  -- old rows must stay interpretable. Token counts mean different money on
  -- different models, so a cost query that assumes one model is wrong the day
  -- after we switch.
  model         VARCHAR(50) NOT NULL,

  input_tokens  INT NOT NULL,
  output_tokens INT NOT NULL,

  -- How many of the returned options survived validation, 0–3. A sustained
  -- run of 0s or 1s means the prompt has drifted out of agreement with the
  -- 60/200-character limits, which would otherwise show up only as merchants
  -- quietly finding the feature useless.
  drafts_kept   TINYINT NOT NULL,

  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- "what has this café spent, recently" — the per-tenant question.
  INDEX (merchant_id, created_at),
  -- "what has the platform spent this month" — the one we will actually ask.
  INDEX (created_at)
);
