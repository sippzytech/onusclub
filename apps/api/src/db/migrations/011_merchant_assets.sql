-- Merchant-uploaded images, stored in the database.
--
-- Not on local disk and not in object storage, and both are deliberate.
--
-- A disk volume is the obvious choice and the wrong one here: it becomes a
-- second thing to carry during the EU hosting migration (ROADMAP item 1), and
-- the one piece of state that a `mysqldump` would silently miss. Object
-- storage (the Backblaze code from Day 13) means an external account and
-- credentials before anything can ship.
--
-- A BLOB has neither problem. It travels with the database dump, needs no new
-- infrastructure, and at one small image per merchant the volume is
-- irrelevant. If this ever grows past a few megabytes per tenant, moving to
-- object storage is a backfill rather than a redesign — the serving endpoint
-- stays the same either way.
--
-- Separate table rather than columns on `merchants` because that row is read
-- on nearly every authenticated request, and a LONGBLOB sitting in it is an
-- invitation for a careless `SELECT *` to drag the image along too.

CREATE TABLE merchant_assets (
  merchant_id  VARCHAR(36) NOT NULL,

  -- 'logo' today. 'hero' is the obvious next one, which is why this is a key
  -- rather than a table called merchant_logos.
  kind         VARCHAR(20) NOT NULL,

  content_type VARCHAR(50) NOT NULL,
  bytes        LONGBLOB NOT NULL,

  -- Short content hash. Serves as the cache-busting token in the public URL:
  -- Google fetches programLogo server-side and caches by URI, so a merchant
  -- replacing their logo would otherwise keep seeing the old one on every pass
  -- indefinitely. Same problem, and same fix, as the Wallet hero image.
  version      VARCHAR(16) NOT NULL,

  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (merchant_id, kind),
  FOREIGN KEY (merchant_id) REFERENCES merchants(id) ON DELETE CASCADE
);
