// Cross-tenant aggregates for the master dashboard.
//
// ⚠️ Every query in this file deliberately omits `merchant_id` from its WHERE
// clause — the opposite of the rule the rest of the codebase follows. That is
// why it lives here rather than beside the single-tenant analytics.
//
// SHAPE: a handful of `GROUP BY merchant_id` queries, joined in Node.
//
// The tempting alternative is to loop over merchants calling the existing
// analytics helpers. Those are all single-tenant by construction, so reusing
// them per merchant is an N+1 — roughly 6 queries × N merchants. Noticeable at
// 20 cafés and unusable at 200. Six full-table GROUP BYs instead stay flat as
// merchant count grows.
//
// Revisit when `card_events` passes a few million rows: at that point the
// unbounded scans here want a rollup table, and the per-merchant detail view
// (which IS scoped, and rides the (merchant_id, created_at) index) is the
// model to follow.

import type { RowDataPacket } from "mysql2";
import {
  ADMIN_HEALTH_THRESHOLDS as T,
  type AdminHealthFlag,
  type AdminMerchantSummary,
} from "@onusclub/shared";
import { pool } from "../db/pool.js";
import { deriveTrial } from "../routes/me.js";

/**
 * What counts as the café *doing business*.
 *
 * Deliberately narrower than "has rows in card_events":
 *
 *  - `signup` is a customer joining, not visiting. A café that enrols people
 *    and never scans anyone again is exactly the failure we want to see, so
 *    counting enrolments as activity would hide it.
 *  - `expire` is written by our own nightly cron. Counting it would make a
 *    completely abandoned café look alive, forever.
 *  - `manual_adjust` is *us*, from this very dashboard. Counting it would mean
 *    fixing a dormant café's card marks it as active — the aggregate would
 *    respond to our own interventions.
 *  - `reset` is a card being wiped, not a visit.
 */
const TXN_TYPES = "('stamp', 'redeem', 'points_add', 'review_reward')";

/** Event types that may carry a sale amount. Mirrors setCardEventAmount's guard. */
const CAPTURABLE_TYPES = "('stamp', 'redeem', 'points_add')";

// The `${T.x}` interpolations below put numbers into SQL, which normally wants
// a placeholder. These specifically are compile-time constants from
// ADMIN_HEALTH_THRESHOLDS — nothing from a request reaches them — and
// `INTERVAL ? DAY` inside a CASE arm is awkward to parameterise consistently.
// Anything that originates in a query string is bound, as everywhere else.

interface MerchantRow extends RowDataPacket {
  id: string;
  business_name: string;
  owner_email: string;
  country: string;
  currency_code: string;
  status: "active" | "suspended" | "trial";
  public_slug: string | null;
  is_premium: number;
  crons_enabled: number;
  trial_ends_at: Date | null;
  monthly_fee_cents: number | null;
  created_at: Date;
  timezone: string | null;
}

interface CountRow extends RowDataPacket {
  merchant_id: string;
  n: number;
}

interface CardAggRow extends RowDataPacket {
  merchant_id: string;
  cards: number;
  google_passes: number;
  apple_passes: number;
  wallet_cards: number;
  mature_cards: number;
  dead_cards: number;
}

interface EventAggRow extends RowDataPacket {
  merchant_id: string;
  events_total: number;
  events_window: number;
  capturable_window: number;
  captured_window: number;
  revenue_window: string | number | null;
  revenue_total: string | number | null;
  redemptions_total: number;
  redemptions_window: number;
  last_txn_at: Date | null;
}

/** SUM()/COUNT() over BIGINT arrives as a string, and SUM() of nothing is NULL. */
function toInt(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function daysSince(when: Date | null): number | null {
  if (!when) return null;
  return Math.max(0, Math.floor((Date.now() - when.getTime()) / 86_400_000));
}

/**
 * Decide which flags apply to one café.
 *
 * Exported and pure so the thresholds can be reasoned about — and tested —
 * without standing up a database.
 */
export function healthFlags(m: {
  createdAt: Date;
  eventsTotal: number;
  daysSinceLastEvent: number | null;
  cards: number;
  matureCards: number;
  deadEnrolments: number;
  walletCards: number;
  capturableWindow: number;
  capturedWindow: number;
}): AdminHealthFlag[] {
  const ageDays = Math.floor((Date.now() - m.createdAt.getTime()) / 86_400_000);

  // Checked first and returned alone. A café that signed up three days ago has
  // no wallet adoption and no capture rate yet, and listing it as four
  // problems would bury the cafés that really have them.
  if (ageDays < T.onboardingDays && m.eventsTotal < T.onboardingEvents) {
    return ["onboarding"];
  }

  // Also terminal: with no transactions at all, every ratio below has a zero
  // denominator and nothing to say.
  if (m.eventsTotal === 0) return ["never_used"];

  const flags: AdminHealthFlag[] = [];

  if (m.daysSinceLastEvent !== null && m.daysSinceLastEvent >= T.dormantDays) {
    flags.push("dormant");
  }

  if (
    m.matureCards >= T.deadEnrolmentsMinCards &&
    m.deadEnrolments / m.matureCards >= T.deadEnrolmentsPct
  ) {
    flags.push("dead_enrolments");
  }

  if (m.cards >= T.walletMinCards && m.walletCards / m.cards < T.walletAdoptionPct) {
    flags.push("low_wallet_adoption");
  }

  if (
    m.capturableWindow >= T.captureMinEvents &&
    m.capturedWindow / m.capturableWindow < T.capturePct
  ) {
    flags.push("low_capture");
  }

  return flags.length > 0 ? flags : ["healthy"];
}

/**
 * Every merchant on the platform with its usage aggregates and health flags.
 *
 * Returns all of them. Filtering and sorting happen in the route, on the
 * assembled objects, because the interesting sorts (by health, by sales per
 * reward) are derived values that no index can serve anyway.
 */
export async function loadMerchantSummaries(): Promise<AdminMerchantSummary[]> {
  const [merchantRows] = await pool.query<MerchantRow[]>(
    `SELECT id, business_name, owner_email, country, currency_code, status,
            public_slug, is_premium, crons_enabled, trial_ends_at,
            monthly_fee_cents, created_at, timezone
       FROM merchants
      ORDER BY created_at DESC`
  );

  const [customerRows] = await pool.query<CountRow[]>(
    "SELECT merchant_id, COUNT(*) AS n FROM customers GROUP BY merchant_id"
  );
  const [programRows] = await pool.query<CountRow[]>(
    "SELECT merchant_id, COUNT(*) AS n FROM loyalty_programs GROUP BY merchant_id"
  );
  const [staffRows] = await pool.query<CountRow[]>(
    "SELECT merchant_id, COUNT(*) AS n FROM staff_users GROUP BY merchant_id"
  );

  // The LEFT JOIN is against a DISTINCT derived table, not against
  // apple_pass_registrations itself: one card can have several device
  // registrations (phone + watch), and joining the raw table would multiply
  // every card row and inflate `cards` along with it.
  //
  // `last_event_at` is written only by stamp/redeem/points operations and
  // never on enrolment, which is what makes `IS NULL` mean "signed up and
  // never transacted" rather than "has no rows".
  const [cardRows] = await pool.query<CardAggRow[]>(
    `SELECT c.merchant_id,
            COUNT(*)                                          AS cards,
            SUM(c.google_wallet_object_id IS NOT NULL)         AS google_passes,
            SUM(r.card_id IS NOT NULL)                         AS apple_passes,
            SUM(c.google_wallet_object_id IS NOT NULL
                OR r.card_id IS NOT NULL)                      AS wallet_cards,
            SUM(c.created_at < NOW() - INTERVAL ${T.cardMaturityDays} DAY)
                                                               AS mature_cards,
            SUM(c.created_at < NOW() - INTERVAL ${T.cardMaturityDays} DAY
                AND c.last_event_at IS NULL)                   AS dead_cards
       FROM loyalty_cards c
       LEFT JOIN (SELECT DISTINCT card_id FROM apple_pass_registrations) r
              ON r.card_id = c.id
      GROUP BY c.merchant_id`
  );

  // Window filters sit inside the aggregates rather than in a WHERE clause so
  // one scan answers both the window and the lifetime figures — same trick as
  // the merchant-facing overview.
  //
  // `amount_cents IS NOT NULL` is what separates "staff skipped the prompt"
  // from "the sale was €0". COUNT(amount_cents) skips NULLs by definition,
  // which is exactly the capture numerator.
  const [eventRows] = await pool.query<EventAggRow[]>(
    `SELECT merchant_id,
            SUM(event_type IN ${TXN_TYPES})                    AS events_total,
            SUM(event_type IN ${TXN_TYPES}
                AND created_at >= NOW() - INTERVAL ${T.windowDays} DAY)
                                                               AS events_window,
            SUM(event_type IN ${CAPTURABLE_TYPES}
                AND created_at >= NOW() - INTERVAL ${T.windowDays} DAY)
                                                               AS capturable_window,
            SUM(event_type IN ${CAPTURABLE_TYPES}
                AND created_at >= NOW() - INTERVAL ${T.windowDays} DAY
                AND amount_cents IS NOT NULL)                  AS captured_window,
            SUM(CASE WHEN created_at >= NOW() - INTERVAL ${T.windowDays} DAY
                     THEN amount_cents END)                    AS revenue_window,
            SUM(amount_cents)                                  AS revenue_total,
            SUM(event_type = 'redeem')                         AS redemptions_total,
            SUM(event_type = 'redeem'
                AND created_at >= NOW() - INTERVAL ${T.windowDays} DAY)
                                                               AS redemptions_window,
            MAX(CASE WHEN event_type IN ${TXN_TYPES} THEN created_at END)
                                                               AS last_txn_at
       FROM card_events
      GROUP BY merchant_id`
  );

  const byId = <R extends { merchant_id: string }>(rows: R[]): Map<string, R> =>
    new Map(rows.map((r) => [r.merchant_id, r]));

  const customers = byId(customerRows);
  const programs = byId(programRows);
  const staff = byId(staffRows);
  const cards = byId(cardRows);
  const events = byId(eventRows);

  return merchantRows.map((m) => {
    const c = cards.get(m.id);
    const e = events.get(m.id);

    const cardCount = toInt(c?.cards);
    const matureCards = toInt(c?.mature_cards);
    const deadEnrolments = toInt(c?.dead_cards);
    const walletCards = toInt(c?.wallet_cards);

    const eventsTotal = toInt(e?.events_total);
    const capturableWindow = toInt(e?.capturable_window);
    const capturedWindow = toInt(e?.captured_window);
    const revenueCentsTotal = toInt(e?.revenue_total);
    const redemptionsTotal = toInt(e?.redemptions_total);
    const lastEvent = e?.last_txn_at ?? null;
    const daysSinceLastEvent = daysSince(lastEvent);

    return {
      id: m.id,
      businessName: m.business_name,
      ownerEmail: m.owner_email,
      country: m.country,
      currencyCode: m.currency_code ?? "EUR",
      status: m.status,
      publicSlug: m.public_slug,
      createdAt: m.created_at.toISOString(),
      trial: deriveTrial(m.trial_ends_at),
      isPremium: Boolean(m.is_premium),
      cronsEnabled: Boolean(m.crons_enabled),
      monthlyFeeCents: m.monthly_fee_cents,

      programs: toInt(programs.get(m.id)?.n),
      staff: toInt(staff.get(m.id)?.n),
      customers: toInt(customers.get(m.id)?.n),
      cards: cardCount,

      walletCards,
      googlePasses: toInt(c?.google_passes),
      applePasses: toInt(c?.apple_passes),

      deadEnrolments,
      matureCards,

      eventsTotal,
      eventsWindow: toInt(e?.events_window),
      capturableWindow,
      capturedWindow,
      revenueCentsWindow: toInt(e?.revenue_window),
      revenueCentsTotal,

      redemptionsWindow: toInt(e?.redemptions_window),
      redemptionsTotal,

      // No ratio without a denominator. Zero would read as "this café earns
      // nothing per reward", which is a different and much worse claim than
      // "this café has never given a reward".
      salesPerRewardCents:
        redemptionsTotal > 0 ? Math.round(revenueCentsTotal / redemptionsTotal) : null,

      lastEventAt: lastEvent ? lastEvent.toISOString() : null,
      daysSinceLastEvent,

      flags: healthFlags({
        createdAt: m.created_at,
        eventsTotal,
        daysSinceLastEvent,
        cards: cardCount,
        matureCards,
        deadEnrolments,
        walletCards,
        capturableWindow,
        capturedWindow,
      }),
    };
  });
}

/** The three numbers the UI needs to state its own rules. */
export const SUMMARY_THRESHOLDS = {
  dormantDays: T.dormantDays,
  windowDays: T.windowDays,
  cardMaturityDays: T.cardMaturityDays,
};
