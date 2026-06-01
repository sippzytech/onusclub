-- 'expired' is a third terminal status for cards that haven't been used in
-- longer than the program's configured expiry window. Used by the daily
-- expiry sweep + Wallet state=EXPIRED PATCH.
ALTER TABLE loyalty_cards
  MODIFY COLUMN status ENUM('active','blocked','expired') NOT NULL DEFAULT 'active';

-- Audience filters for broadcasts (e.g. "min 5 lifetime stamps"). Stored as
-- JSON so we can add new filter kinds without further migrations.
ALTER TABLE broadcasts
  ADD COLUMN audience_filter JSON NULL AFTER body;
