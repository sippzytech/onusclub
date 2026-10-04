// Weekly merchant digest — backlog item 18.
//
// One email a week telling a café owner what their loyalty programme actually
// did. Retention: the dashboard is good, but nobody logs into a dashboard
// unprompted, and a café that stops looking is a café that stops scanning.
//
// NOT gated on `is_premium`. The same reasoning as "Analytics stays free, not
// premium-gated" (ROADMAP, decided 2026-10-02): this is the screen that makes
// the product feel alive, and withholding it from the cafés most at risk of
// drifting away is working against yourself.
//
// It IS gated on `crons_enabled`, which is the existing per-merchant kill
// switch every other sweep respects.
//
// Note it was labelled "gated on item 4" (Resend's cap) until 2026-10-05. That
// was wrong, and inherited from the same mistake that had broadcasts sending
// email: this goes to *merchants*, a handful of addresses once a week, against
// a 100/day limit.
//
// ⚠️ That said, this is the one sender that scales with MERCHANT count rather
// than customer signups, and it fires all at once. At four cafés it is four
// emails; past roughly 90 it would consume a whole day of Resend's free quota
// in a single Monday-morning burst and starve the card invites. Resend Pro
// (ROADMAP item 4, $20/mo, no code change) lands long before that — but if
// merchant count ever approaches that number without it, batch this across
// the day before anything else.

import type { RowDataPacket } from "mysql2";
import { centsToEuroString } from "@onusclub/shared";
import { pool } from "../db/pool.js";
import { logger } from "../logger.js";
import { sendEmail } from "../email/client.js";
import { weeklyDigestEmail } from "../email/templates.js";
import { env } from "../config.js";

export interface DigestResult {
  /** Merchants considered. */
  scanned: number;
  sent: number;
  /** Skipped: nothing to report yet, or already sent this week. */
  skipped: number;
  failed: number;
}

/**
 * What counts as a visit. Same definition as the admin health metrics, and for
 * the same reasons: `signup` is joining rather than visiting, `expire` is our
 * own cron, and `manual_adjust` is us — none of them are the café doing
 * business, and counting them would flatter a quiet week.
 */
const TXN_TYPES = "('stamp', 'redeem', 'points_add', 'review_reward')";

interface MerchantRow extends RowDataPacket {
  id: string;
  business_name: string;
  owner_email: string;
  currency_code: string;
  cards: number;
}

interface StatsRow extends RowDataPacket {
  merchant_id: string;
  scans_week: number;
  scans_prev: number;
  redeems_week: number;
  revenue_week: string | number | null;
  captured_week: number;
}

interface SignupRow extends RowDataPacket {
  merchant_id: string;
  n: number;
}

interface AlreadySentRow extends RowDataPacket {
  merchant_id: string;
}

function toInt(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/**
 * Send this week's digest to every eligible merchant.
 *
 * `force` skips the already-sent-this-week check, for the manual trigger used
 * in dev and by the smoke suite.
 */
export async function runWeeklyDigest(opts: { force?: boolean } = {}): Promise<DigestResult> {
  const result: DigestResult = { scanned: 0, sent: 0, skipped: 0, failed: 0 };

  // Only cafés that have actually started. A digest reading "0 stamps" to
  // someone who has not created a card yet is noise; the same email to a café
  // that WAS busy and went quiet is the single most useful thing we can send,
  // which is why zero-activity weeks are not skipped — only zero-card ones.
  const [merchants] = await pool.query<MerchantRow[]>(
    `SELECT m.id, m.business_name, m.owner_email, m.currency_code,
            COUNT(c.id) AS cards
       FROM merchants m
       LEFT JOIN loyalty_cards c ON c.merchant_id = m.id
      WHERE m.crons_enabled = TRUE
        AND m.status <> 'suspended'
      GROUP BY m.id
     HAVING cards > 0`
  );
  result.scanned = merchants.length;
  if (merchants.length === 0) return result;

  // One pass for both windows, so the "vs last week" comparison costs nothing
  // extra. Rides the (merchant_id, created_at) index from 001_initial.
  const [statsRows] = await pool.query<StatsRow[]>(
    `SELECT merchant_id,
            SUM(event_type IN ${TXN_TYPES}
                AND created_at >= NOW() - INTERVAL 7 DAY)              AS scans_week,
            SUM(event_type IN ${TXN_TYPES}
                AND created_at >= NOW() - INTERVAL 14 DAY
                AND created_at <  NOW() - INTERVAL 7 DAY)              AS scans_prev,
            SUM(event_type = 'redeem'
                AND created_at >= NOW() - INTERVAL 7 DAY)              AS redeems_week,
            SUM(CASE WHEN created_at >= NOW() - INTERVAL 7 DAY
                     THEN amount_cents END)                            AS revenue_week,
            COUNT(CASE WHEN created_at >= NOW() - INTERVAL 7 DAY
                       THEN amount_cents END)                          AS captured_week
       FROM card_events
      WHERE created_at >= NOW() - INTERVAL 14 DAY
      GROUP BY merchant_id`
  );
  const stats = new Map(statsRows.map((r) => [r.merchant_id, r]));

  const [signupRows] = await pool.query<SignupRow[]>(
    `SELECT merchant_id, COUNT(*) AS n
       FROM customers
      WHERE created_at >= NOW() - INTERVAL 7 DAY
      GROUP BY merchant_id`
  );
  const signups = new Map(signupRows.map((r) => [r.merchant_id, toInt(r.n)]));

  // Idempotency without a new table or a sweep_runs enum change: ask
  // email_deliveries whether this merchant already got one recently. A
  // container restart, a double cron fire, or a manual run on the same day
  // must not send two digests.
  //
  // 6 days rather than 7 so a cron that drifts slightly later week to week
  // does not eventually skip a week entirely.
  const alreadySent = new Set<string>();
  if (!opts.force) {
    const [sentRows] = await pool.query<AlreadySentRow[]>(
      `SELECT DISTINCT merchant_id FROM email_deliveries
        WHERE kind = 'weekly_digest'
          AND status IN ('sent', 'skipped')
          AND created_at >= NOW() - INTERVAL 6 DAY`
    );
    for (const r of sentRows) if (r.merchant_id) alreadySent.add(r.merchant_id);
  }

  for (const m of merchants) {
    if (alreadySent.has(m.id)) {
      result.skipped += 1;
      continue;
    }

    const s = stats.get(m.id);
    const scans = toInt(s?.scans_week);
    const prev = toInt(s?.scans_prev);
    const revenueCents = toInt(s?.revenue_week);

    const currency = m.currency_code ?? "EUR";
    const { subject, html, text } = weeklyDigestEmail({
      businessName: m.business_name,
      dashboardUrl: `${env.BASE_URL_WEB.replace(/\/$/, "")}/dashboard`,
      scans,
      previousScans: prev,
      newCustomers: signups.get(m.id) ?? 0,
      rewardsRedeemed: toInt(s?.redeems_week),
      // Only shown when some sales were actually captured — a café whose staff
      // skip the amount prompt should see nothing here rather than €0.00.
      revenue: toInt(s?.captured_week) > 0 ? centsToEuroString(revenueCents, currency) : null,
    });

    const sendResult = await sendEmail({
      kind: "weekly_digest",
      merchantId: m.id,
      to: m.owner_email,
      subject,
      html,
      text,
    });
    if (sendResult.ok) result.sent += 1;
    else result.failed += 1;
  }

  logger.info(result, "weekly digest complete");
  return result;
}
