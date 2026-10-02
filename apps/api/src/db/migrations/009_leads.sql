-- Leads captured from the marketing site (onusclub.com).
--
-- Deliberately NOT tied to merchants: a lead is someone who has not signed up
-- yet, and most never will. Joining this to the tenant tables would mean
-- inventing a merchant row for every form fill.
--
-- Context for why this exists at all: both forms on the marketing site
-- validated input, showed a success state, and then threw the data away —
-- `setSubmitted(true)` with no network call anywhere, and no app/api directory
-- on that site. Every demo request since launch was lost, and the visitor was
-- told otherwise.

CREATE TABLE leads (
  id            VARCHAR(36) PRIMARY KEY,

  -- Which form it came from. Same table because the follow-up workflow is the
  -- same; the shape differs only in which columns are populated.
  source        ENUM('demo','newsletter') NOT NULL,

  email         VARCHAR(200) NOT NULL,
  name          VARCHAR(200),
  phone         VARCHAR(40),
  business_name VARCHAR(200),
  business_type VARCHAR(100),
  message       TEXT,

  -- Where they came from, for attribution. referer is whatever the browser
  -- reported; treat it as untrusted and display-only.
  referer       VARCHAR(500),

  -- SHA-256 of the submitter's IP, never the IP itself. Enough to spot a flood
  -- from one source or dedupe a double-submit, without storing an identifier
  -- we have no reason to keep. These are EU data subjects and this is a
  -- marketing contact record, so the less we hold the better.
  ip_hash       CHAR(64),

  -- Follow-up state. 'spam' rather than deletion so a false positive can be
  -- recovered and the filter can be judged.
  status        ENUM('new','contacted','converted','spam') NOT NULL DEFAULT 'new',

  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- The working query is "new leads, newest first".
  INDEX (status, created_at),
  -- Used to collapse repeat submissions from the same person.
  INDEX (email, source)
);
