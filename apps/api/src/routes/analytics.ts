// Day 15: the numbers behind the Overview page.
//
// Everything monetary here derives from card_events.amount_cents — the sale
// amount a merchant optionally types at scan time. We have no POS
// integration and do not plan one; see PERKSTAR_ANALYSIS.md for why that
// trade is the right one for our user base.

import { Router, type Request, type Response } from "express";
import type { RowDataPacket } from "mysql2";
import {
  AnalyticsRange,
  DEFAULT_RFM_THRESHOLDS,
  classifyRfm,
  type ActivityEvent,
  type AnalyticsDayBucket,
  type AnalyticsDetail,
  type AnalyticsOverview,
  type AnalyticsTopMember,
  type RfmOverview,
  type RfmSegment,
} from "@onusclub/shared";
import { pool } from "../db/pool.js";
import { authContext, requireAuth } from "../auth/middleware.js";

export const analyticsRouter: Router = Router();

interface RevenueRow extends RowDataPacket {
  revenue_7d: string | number | null;
  revenue_30d: string | number | null;
  txns_7d: number;
}

interface ActivityRow extends RowDataPacket {
  id: number;
  card_id: string;
  customer_name: string | null;
  program_name: string;
  event_type: ActivityEvent["eventType"];
  amount_cents: string | number | null;
  created_at: Date;
}

interface CurrencyRow extends RowDataPacket {
  currency_code: string;
}

// SUM() over BIGINT comes back as a string from mysql2 (it cannot know the
// total fits in a double), and SUM() of an empty set is NULL, not 0.
function toInt(value: string | number | null): number {
  if (value === null) return 0;
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? Math.round(n) : 0;
}

analyticsRouter.get(
  "/overview",
  requireAuth,
  async (req: Request, res: Response<AnalyticsOverview>) => {
    const ctx = authContext(req);

    // One pass over the merchant's events for both windows. Uses the
    // (merchant_id, created_at) index from 001_initial.
    //
    // The 7d/30d filters live inside SUM() rather than in a WHERE clause so a
    // single scan answers both windows. `amount_cents IS NOT NULL` is what
    // separates "merchant skipped the prompt" from "the sale was €0" — only
    // captured amounts count, otherwise every skipped scan would drag AOV
    // toward zero.
    const [revenueRows] = await pool.execute<RevenueRow[]>(
      `SELECT
         SUM(CASE WHEN created_at >= NOW() - INTERVAL 7 DAY
                  THEN amount_cents END)              AS revenue_7d,
         SUM(CASE WHEN created_at >= NOW() - INTERVAL 30 DAY
                  THEN amount_cents END)              AS revenue_30d,
         COUNT(CASE WHEN created_at >= NOW() - INTERVAL 7 DAY
                    THEN amount_cents END)            AS txns_7d
       FROM card_events
      WHERE merchant_id = ?
        AND amount_cents IS NOT NULL
        AND created_at >= NOW() - INTERVAL 30 DAY`,
      [ctx.merchantId]
    );

    const revenueCents7d = toInt(revenueRows[0]?.revenue_7d ?? null);
    const revenueCents30d = toInt(revenueRows[0]?.revenue_30d ?? null);
    const transactions7d = toInt(revenueRows[0]?.txns_7d ?? null);

    // Real events, not each card's last_event_at: a card stamped three times
    // today should appear three times, and each row carries its own amount.
    // 'signup' and 'expire' are included — a new member joining is exactly
    // the kind of thing an owner wants to watch land.
    const [activityRows] = await pool.execute<ActivityRow[]>(
      `SELECT e.id, e.card_id, e.event_type, e.amount_cents, e.created_at,
              cu.name AS customer_name,
              p.name  AS program_name
         FROM card_events e
         JOIN loyalty_cards c   ON c.id = e.card_id
         JOIN customers cu      ON cu.id = c.customer_id
         JOIN loyalty_programs p ON p.id = c.program_id
        WHERE e.merchant_id = ?
        ORDER BY e.id DESC
        LIMIT 10`,
      [ctx.merchantId]
    );

    const [currencyRows] = await pool.execute<CurrencyRow[]>(
      "SELECT currency_code FROM merchants WHERE id = ? LIMIT 1",
      [ctx.merchantId]
    );

    return res.json({
      currencyCode: currencyRows[0]?.currency_code ?? "EUR",
      revenueCents7d,
      revenueCents30d,
      transactions7d,
      // No average of nothing. Null tells the UI to render a dash rather than
      // a confident-looking €0.00.
      aovCents7d:
        transactions7d > 0 ? Math.round(revenueCents7d / transactions7d) : null,
      recentEvents: activityRows.map((r) => ({
        id: r.id,
        cardId: r.card_id,
        customerName: r.customer_name,
        programName: r.program_name,
        eventType: r.event_type,
        amountCents: r.amount_cents === null ? null : toInt(r.amount_cents),
        createdAt: new Date(r.created_at).toISOString(),
      })),
    });
  }
);

// ---------------------------------------------------------------------------
// Day 17: GET /v1/analytics/detail
//
// Separate from /overview on purpose. The dashboard hits /overview on every
// load; this one is heavier and only runs when someone opens the analytics
// page.
//
// ## The timezone problem, and why it is solved in Node
//
// card_events.created_at is UTC (the MySQL server runs SYSTEM = UTC, so NOW()
// and UTC_TIMESTAMP() agree). Merchants are not: merchants.timezone defaults
// to Europe/Amsterdam. Bucketing UTC timestamps into named days and hours
// therefore needs a conversion, and getting it wrong is insidious — a stamp at
// 00:30 Amsterdam is 22:30 UTC the *previous* day, and a "busiest hours"
// chart built on raw UTC hours is off by one or two with no visible symptom.
//
// Two tempting SQL fixes, both rejected:
//
//   CONVERT_TZ(t,'UTC','Europe/Amsterdam')  — returns NULL, not an error, when
//     the server's timezone tables are not populated. It happens to work on
//     our image today, but that is an ops property of the container, not a
//     guarantee. The failure mode is silently empty charts.
//
//   CONVERT_TZ(t,'+00:00','+02:00')  — no table dependency, but wrong for
//     half the year. Europe/Amsterdam is +01:00 in winter and +02:00 in
//     summer, so a 12-month histogram smears by an hour and still looks
//     entirely plausible.
//
// So: MySQL groups by UTC hour (cheap, and rides the (merchant_id, created_at)
// index from 001_initial), and Node re-buckets each hour into merchant-local
// days and hours via Intl, which is DST-correct by construction because every
// hour is converted at its own instant. node:20-alpine ships full ICU, so the
// named zones resolve.
// ---------------------------------------------------------------------------

const RANGE_DAYS: Record<AnalyticsRange, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "12m": 365,
};

const DEFAULT_TZ = "Europe/Amsterdam";

// Constructing an Intl.DateTimeFormat is expensive and we call this once per
// populated hour — up to 8,760 times on a 12-month range.
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    // h23 rather than hour12:false — some locales render midnight as "24"
    // under hour12:false, which would produce an out-of-range bucket.
    hourCycle: "h23",
  });
  formatterCache.set(timeZone, fmt);
  return fmt;
}

/**
 * An unknown IANA zone makes Intl throw, so a bad DB value must not 500.
 *
 * Exported for the admin surface, which buckets each merchant's activity in
 * that merchant's own zone for the same reason this page does.
 */
export function safeZone(tz: string | null): string {
  if (!tz) return DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}

export function localDayHour(instant: Date, timeZone: string): { date: string; hour: number } {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
  };
}

interface HourRow extends RowDataPacket {
  utc_hour: string;
  visits: number;
  revenue_cents: string | number | null;
  txns: number;
}

interface CardAggRow extends RowDataPacket {
  card_id: string;
  customer_name: string | null;
  visits: number;
  revenue_cents: string | number | null;
}

interface MerchantMetaRow extends RowDataPacket {
  currency_code: string;
  timezone: string | null;
}

analyticsRouter.get(
  "/detail",
  requireAuth,
  async (req: Request, res: Response<AnalyticsDetail>) => {
    const ctx = authContext(req);
    const range = AnalyticsRange.catch("30d").parse(req.query.range);
    const days = RANGE_DAYS[range];

    const [metaRows] = await pool.execute<MerchantMetaRow[]>(
      "SELECT currency_code, timezone FROM merchants WHERE id = ? LIMIT 1",
      [ctx.merchantId]
    );
    const currencyCode = metaRows[0]?.currency_code ?? "EUR";
    const timeZone = safeZone(metaRows[0]?.timezone ?? null);

    // Explicit UTC string rather than handing mysql2 a Date: mysql2's default
    // `timezone: 'local'` would serialise it through the Node process zone,
    // which is only UTC here by coincidence.
    const startMs = Date.now() - days * 86_400_000;
    const startSql = new Date(startMs).toISOString().slice(0, 19).replace("T", " ");

    // "Visits" = the moments a customer actually transacted. signup is joining,
    // not visiting; expire is a cron, not a person.
    const [hourRows] = await pool.execute<HourRow[]>(
      `SELECT DATE_FORMAT(created_at, '%Y-%m-%dT%H:00:00.000Z') AS utc_hour,
              COUNT(*)                        AS visits,
              SUM(COALESCE(amount_cents, 0))  AS revenue_cents,
              COUNT(amount_cents)             AS txns
         FROM card_events
        WHERE merchant_id = ?
          AND created_at >= ?
          AND event_type IN ('stamp', 'points_add')
        GROUP BY utc_hour
        ORDER BY utc_hour`,
      [ctx.merchantId, startSql]
    );

    // Pre-seed every local day in the window so a quiet Tuesday renders as a
    // zero rather than vanishing and compressing the x-axis.
    const dayMap = new Map<string, AnalyticsDayBucket>();
    for (let i = 0; i <= days; i += 1) {
      // Anchor at midday so a DST transition cannot push the sample onto the
      // wrong calendar date.
      const probe = new Date(startMs + i * 86_400_000 + 43_200_000);
      const { date } = localDayHour(probe, timeZone);
      if (!dayMap.has(date)) dayMap.set(date, { date, visits: 0, revenueCents: 0 });
    }

    const hourTotals = Array.from({ length: 24 }, (_, hour) => ({ hour, visits: 0 }));
    let totalVisits = 0;
    let totalRevenueCents = 0;
    let totalTxns = 0;

    for (const row of hourRows) {
      const instant = new Date(row.utc_hour);
      const { date, hour } = localDayHour(instant, timeZone);
      const visits = toInt(row.visits);
      const revenue = toInt(row.revenue_cents);

      const bucket = dayMap.get(date);
      if (bucket) {
        bucket.visits += visits;
        bucket.revenueCents += revenue;
      }
      if (hour >= 0 && hour < 24) hourTotals[hour].visits += visits;

      totalVisits += visits;
      totalRevenueCents += revenue;
      totalTxns += toInt(row.txns);
    }

    // One row per card that transacted in the window. Needed in full rather
    // than pre-limited: new-vs-returning is a count over all of them, and
    // LIMITing here would silently bias it.
    const [cardRows] = await pool.execute<CardAggRow[]>(
      `SELECT e.card_id,
              cu.name                         AS customer_name,
              COUNT(*)                        AS visits,
              SUM(COALESCE(e.amount_cents, 0)) AS revenue_cents
         FROM card_events e
         JOIN loyalty_cards c ON c.id = e.card_id
         JOIN customers cu    ON cu.id = c.customer_id
        WHERE e.merchant_id = ?
          AND e.created_at >= ?
          AND e.event_type IN ('stamp', 'points_add')
        GROUP BY e.card_id, cu.name`,
      [ctx.merchantId, startSql]
    );

    const members: AnalyticsTopMember[] = cardRows.map((r) => ({
      cardId: r.card_id,
      customerName: r.customer_name,
      visits: toInt(r.visits),
      revenueCents: toInt(r.revenue_cents),
    }));

    // "Returning" is scoped to the selected range on purpose: a customer of
    // two years who came in once this week is new *to this period*, which is
    // the question the chart is actually asking.
    const returningCards = members.filter((m) => m.visits > 1).length;
    const newCards = members.length - returningCards;

    const topByVisits = [...members]
      .sort((a, b) => b.visits - a.visits || b.revenueCents - a.revenueCents)
      .slice(0, 5);
    const topByRevenue = [...members]
      .filter((m) => m.revenueCents > 0)
      .sort((a, b) => b.revenueCents - a.revenueCents || b.visits - a.visits)
      .slice(0, 5);

    return res.json({
      range,
      timezone: timeZone,
      currencyCode,
      series: Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
      hours: hourTotals,
      newCards,
      returningCards,
      topByVisits,
      topByRevenue,
      totalVisits,
      totalRevenueCents,
      // Denominator is captured amounts only — otherwise every skipped prompt
      // drags the average toward zero. Same rule as /overview.
      aovCents: totalTxns > 0 ? Math.round(totalRevenueCents / totalTxns) : null,
    });
  }
);

// ---------------------------------------------------------------------------
// Day 20: GET /v1/analytics/segments — RFM
//
// Not range-scoped, unlike /detail. Recency only means anything measured from
// now to a customer's last visit ever; bounding it to "the last 30 days" would
// make everyone outside the window look identically lapsed.
//
// Grouped by CUSTOMER, not card. Someone holding a stamp card and a points
// card is one person, and counting them twice would inflate every bucket.
// ---------------------------------------------------------------------------

interface SegmentRow extends RowDataPacket {
  customer_id: string;
  days_since: number;
  visits: number;
  revenue_cents: string | number | null;
}

analyticsRouter.get(
  "/segments",
  requireAuth,
  async (req: Request, res: Response<RfmOverview>) => {
    const ctx = authContext(req);

    const [metaRows] = await pool.execute<MerchantMetaRow[]>(
      "SELECT currency_code, timezone FROM merchants WHERE id = ? LIMIT 1",
      [ctx.merchantId]
    );
    const currencyCode = metaRows[0]?.currency_code ?? "EUR";

    // DATEDIFF works on dates, so this is whole days in UTC. At thresholds of
    // 30 and 90 days a few hours of timezone skew cannot move anyone across a
    // boundary in a way that matters, so it is deliberately not converted the
    // way the hourly buckets in /detail are.
    const [rows] = await pool.execute<SegmentRow[]>(
      `SELECT c.customer_id,
              DATEDIFF(NOW(), MAX(e.created_at)) AS days_since,
              COUNT(*)                           AS visits,
              SUM(COALESCE(e.amount_cents, 0))   AS revenue_cents
         FROM card_events e
         JOIN loyalty_cards c ON c.id = e.card_id
        WHERE e.merchant_id = ?
          AND e.event_type IN ('stamp', 'points_add')
        GROUP BY c.customer_id`,
      [ctx.merchantId]
    );

    // Thresholds are not configurable yet — the settings UI belongs with the
    // master dashboard. Echoed back so the page can state the rule it is
    // applying instead of presenting the buckets as self-evident.
    const thresholds = DEFAULT_RFM_THRESHOLDS;

    const order: RfmSegment[] = [
      "champions",
      "promising",
      "new",
      "at_risk",
      "sleeping",
      "lost",
    ];
    const tally = new Map<RfmSegment, { customers: number; revenueCents: number }>(
      order.map((s) => [s, { customers: 0, revenueCents: 0 }])
    );

    for (const row of rows) {
      const segment = classifyRfm(toInt(row.days_since), toInt(row.visits), thresholds);
      const bucket = tally.get(segment);
      if (!bucket) continue;
      bucket.customers += 1;
      bucket.revenueCents += toInt(row.revenue_cents);
    }

    return res.json({
      thresholds,
      currencyCode,
      // Always all six in a fixed order, so the UI layout does not reflow as
      // buckets empty and fill.
      segments: order.map((segment) => ({
        segment,
        customers: tally.get(segment)!.customers,
        revenueCents: tally.get(segment)!.revenueCents,
      })),
      totalClassified: rows.length,
    });
  }
);
