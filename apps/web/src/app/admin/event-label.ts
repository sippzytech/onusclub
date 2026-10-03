/**
 * Operator-side wording for `card_events.event_type`.
 *
 * Note `manual_adjust` reads "Adjusted by us" here and "Adjusted by OnUsClub"
 * on the café's own dashboard. Deliberately different audiences, deliberately
 * the same event: the café must be able to see every change we make to their
 * data, in their own words, without having to ask.
 */
export const EVENT_LABEL: Record<string, string> = {
  stamp: "Stamp",
  redeem: "Reward redeemed",
  points_add: "Points added",
  review_reward: "Review reward",
  signup: "Joined",
  expire: "Card expired",
  reset: "Card reset",
  manual_adjust: "Adjusted by us",
};
