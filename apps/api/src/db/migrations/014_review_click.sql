-- Record that a customer tapped through to leave a Google review.
--
-- ⚠️ A TAP IS NOT A REVIEW, AND NOT A REWARD.
--
-- Google reports nothing back: it will never tell a café which reviews came
-- from us. The tap is the only signal that exists, which is the entire reason
-- for recording it — without it a merchant has no way to know the prompt does
-- anything at all. Nothing is given to the customer for tapping, and nothing
-- may be: Google's Fake Engagement policy prohibits incentivising reviews and
-- names loyalty points explicitly, with the penalty landing on the café's own
-- listing. See packages/shared/src/reviews.ts.
--
-- ⚠️ APPENDED AT THE END OF THE ENUM, DELIBERATELY.
--
-- MySQL 8 performs an in-place ALTER when a value is added after the existing
-- ones, and a full table rebuild when one is inserted into the middle. On
-- card_events — the largest table in the product and the one on the scan hot
-- path — that difference matters. Keep appending.
--
-- ⚠️ `review_click` must NEVER join TXN_TYPES.
--
-- That constant (admin/overview.ts, messaging/digest.ts,
-- routes/admin/customers.ts, and inline in routes/admin/merchants.ts) defines
-- what counts as the café *doing business*. A review tap is not a visit.
-- Counting it would inflate health flags, the weekly digest and every "scans"
-- figure — the same reason `signup`, `expire` and `manual_adjust` are already
-- excluded.

ALTER TABLE card_events
  MODIFY COLUMN event_type ENUM('stamp','redeem','reset','manual_adjust','points_add',
                                'review_reward','signup','expire','review_click') NOT NULL;
