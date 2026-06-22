-- Day 12: Apple Wallet live updates (web service + APNs push).
--
-- Two changes:
--
-- 1. Per-card `apple_auth_token` — random per-card secret that Apple's
--    Wallet app sends back in the `Authorization: ApplePass <token>` header
--    on every web-service call. Lets us prove the request is really for
--    *this* card without exposing the qr_token (which is the merchant-scan
--    credential and lives in a different trust domain).
--
-- 2. `apple_pass_registrations` — one row per (device, pass) pair. iPhone
--    Wallet calls our POST /devices/.../registrations/... endpoint with its
--    device library ID + an APNs push token when the customer adds the
--    pass. We use those tokens to fan out push notifications on every
--    stamp/redeem so the pass auto-refreshes in Wallet.
--
-- Unique key (device_library_identifier, pass_type_identifier, serial_number)
-- because Wallet treats that triple as the registration identity — a second
-- POST with the same triple is a no-op idempotent re-registration, not a
-- new row.

ALTER TABLE loyalty_cards
  ADD COLUMN apple_auth_token CHAR(64) NULL AFTER qr_token;

CREATE TABLE apple_pass_registrations (
  id CHAR(36) NOT NULL,
  card_id CHAR(36) NOT NULL,
  device_library_identifier VARCHAR(128) NOT NULL,
  push_token VARCHAR(255) NOT NULL,
  pass_type_identifier VARCHAR(128) NOT NULL,
  serial_number VARCHAR(128) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_device_pass (device_library_identifier, pass_type_identifier, serial_number),
  KEY idx_card (card_id),
  KEY idx_pass_serial (pass_type_identifier, serial_number),
  CONSTRAINT fk_apple_reg_card FOREIGN KEY (card_id) REFERENCES loyalty_cards(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
