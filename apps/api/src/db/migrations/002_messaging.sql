-- Owner birthday for the customer (used by the birthday sweep).
ALTER TABLE customers
  ADD COLUMN birthday DATE NULL AFTER name;

CREATE INDEX customers_merchant_birthday_idx ON customers (merchant_id, birthday);

-- One row per owner-triggered broadcast. status starts at 'running' and is
-- bumped to 'completed' once the background loop finishes processing all
-- candidate cards.
CREATE TABLE broadcasts (
  id           VARCHAR(36) PRIMARY KEY,
  merchant_id  VARCHAR(36) NOT NULL,
  header       VARCHAR(60)  NOT NULL,
  body         VARCHAR(200) NOT NULL,
  status       ENUM('running','completed','failed') NOT NULL DEFAULT 'running',
  scanned      INT NOT NULL DEFAULT 0,
  sent         INT NOT NULL DEFAULT 0,
  failed       INT NOT NULL DEFAULT 0,
  started_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  finished_at  TIMESTAMP NULL,
  FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE,
  INDEX (merchant_id, started_at)
);

-- One row per cron run (birthday or inactivity). The sweep iterates across
-- all merchants; the per-card details land in message_deliveries which is
-- where merchant scoping happens at read time.
CREATE TABLE sweep_runs (
  id            VARCHAR(36) PRIMARY KEY,
  sweep_type    ENUM('birthday','inactivity') NOT NULL,
  status        ENUM('running','completed','failed') NOT NULL DEFAULT 'running',
  scanned       INT NOT NULL DEFAULT 0,
  sent          INT NOT NULL DEFAULT 0,
  failed        INT NOT NULL DEFAULT 0,
  started_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  finished_at   TIMESTAMP NULL,
  error_message VARCHAR(500) NULL,
  INDEX (sweep_type, started_at)
);

-- One row per (source, card) — the granular delivery log. Used by:
--   - the inactivity dedup (don't re-send within 30 days)
--   - the birthday dedup (don't re-send same day)
--   - the per-source detail UI ("47 sent, 3 failed — see which ones")
--   - the retry-failed flow
-- source_type drives the join (`source_id` → broadcasts.id OR sweep_runs.id).
CREATE TABLE message_deliveries (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  source_type     ENUM('broadcast','birthday','inactivity') NOT NULL,
  source_id       VARCHAR(36) NOT NULL,
  merchant_id     VARCHAR(36) NOT NULL,
  card_id         VARCHAR(36) NOT NULL,
  customer_id     VARCHAR(36) NOT NULL,
  status          ENUM('pending','sent','failed') NOT NULL DEFAULT 'pending',
  attempts        INT NOT NULL DEFAULT 0,
  last_error      VARCHAR(500) NULL,
  last_attempt_at TIMESTAMP NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (card_id) REFERENCES loyalty_cards(id) ON DELETE CASCADE,
  INDEX (source_type, source_id),
  INDEX (merchant_id, source_type, status),
  INDEX (card_id, source_type, status, created_at)
);
