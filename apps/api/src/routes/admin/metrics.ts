// Platform-wide totals for the master dashboard's top strip.
//
// Derived by summing the per-merchant aggregates rather than by running a
// second set of unscoped queries. One source means the platform total and the
// list below it can never disagree — and "the header says 412 customers but
// the rows add to 390" is exactly the kind of thing that quietly destroys
// trust in a dashboard.

import { Router, type Request, type Response } from "express";
import type { RowDataPacket } from "mysql2";
import {
  ADMIN_HEALTH_SEVERITY,
  primaryHealthFlag,
  type AdminHealthFlag,
  type AdminPlatformMetrics,
  type AiDraftSpend,
  type EmailHealth,
} from "@onusclub/shared";
import { pool } from "../../db/pool.js";
import { loadMerchantSummaries } from "../../admin/overview.js";
import { loadEmailHealth } from "../../email/health.js";

export const adminMetricsRouter: Router = Router();

interface WeekRow extends RowDataPacket {
  week_start: string;
  n: number;
}

/** Weeks to show in the signup chart. */
const WEEKS = 12;

/**
 * GET /v1/admin/metrics/email — platform-wide, including the lead
 * notifications that belong to no tenant.
 *
 * Separate from /metrics rather than folded into it: this is the one figure we
 * want to be able to look at on its own when something smells, and /metrics is
 * already doing six cross-tenant aggregates.
 */
adminMetricsRouter.get("/email", async (_req: Request, res: Response<EmailHealth>) => {
  return res.json(await loadEmailHealth(null));
});

/** Window for the AI spend figures. A month is the unit an invoice arrives in. */
const AI_WINDOW_DAYS = 30;
/** Enough to see who is driving the bill. Not a ledger. */
const AI_TOP_MERCHANTS = 5;

interface AiTotalsRow extends RowDataPacket {
  calls: number;
  input_tokens: string | number | null;
  output_tokens: string | number | null;
  empty_calls: number;
}

interface AiMerchantRow extends RowDataPacket {
  merchant_id: string;
  business_name: string | null;
  calls: number;
  input_tokens: string | number | null;
  output_tokens: string | number | null;
}

const toInt = (v: string | number | null): number => (v === null ? 0 : Number(v));

/**
 * GET /v1/admin/metrics/ai — what AI drafting has cost, platform-wide.
 *
 * Its own endpoint for the same reason /email is: the question is asked on its
 * own, when the Anthropic invoice looks wrong, and folding it into /metrics
 * would make the dashboard's main call do eight aggregates instead of six.
 *
 * ⚠️ Cross-tenant by design — this is why it lives under routes/admin/.
 * Authorization is applied once, to the /v1/admin mount in index.ts.
 *
 * Returns null-safe zeroes rather than throwing if `ai_drafts` is missing, so
 * /admin still renders on a box where migration 015 has not run yet. Same
 * handling the email panel already has for 013.
 */
adminMetricsRouter.get("/ai", async (_req: Request, res: Response<AiDraftSpend>) => {
  const [totals] = await pool.query<AiTotalsRow[]>(
    `SELECT COUNT(*)                                   AS calls,
            SUM(input_tokens)                          AS input_tokens,
            SUM(output_tokens)                         AS output_tokens,
            SUM(CASE WHEN drafts_kept = 0 THEN 1 ELSE 0 END) AS empty_calls
       FROM ai_drafts
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ${AI_WINDOW_DAYS} DAY)`
  );

  const [perMerchant] = await pool.query<AiMerchantRow[]>(
    `SELECT d.merchant_id,
            m.business_name,
            COUNT(*)           AS calls,
            SUM(d.input_tokens)  AS input_tokens,
            SUM(d.output_tokens) AS output_tokens
       FROM ai_drafts d
       LEFT JOIN merchants m ON m.id = d.merchant_id
      WHERE d.created_at >= DATE_SUB(NOW(), INTERVAL ${AI_WINDOW_DAYS} DAY)
      GROUP BY d.merchant_id, m.business_name
      ORDER BY SUM(d.input_tokens + d.output_tokens) DESC
      LIMIT ${AI_TOP_MERCHANTS}`
  );

  return res.json({
    windowDays: AI_WINDOW_DAYS,
    calls: toInt(totals[0]?.calls ?? 0),
    inputTokens: toInt(totals[0]?.input_tokens ?? 0),
    outputTokens: toInt(totals[0]?.output_tokens ?? 0),
    emptyCalls: toInt(totals[0]?.empty_calls ?? 0),
    topMerchants: perMerchant.map((r) => ({
      merchantId: r.merchant_id,
      // LEFT JOIN, so a draft from a since-deleted café still shows its spend
      // rather than vanishing from the total.
      businessName: r.business_name ?? "(deleted)",
      calls: toInt(r.calls),
      inputTokens: toInt(r.input_tokens),
      outputTokens: toInt(r.output_tokens),
    })),
  });
});

adminMetricsRouter.get("/", async (_req: Request, res: Response<AdminPlatformMetrics>) => {
  const merchants = await loadMerchantSummaries();

  const sum = (pick: (m: (typeof merchants)[number]) => number): number =>
    merchants.reduce((acc, m) => acc + pick(m), 0);

  // Suspended accounts are excluded from MRR: whatever they agreed to pay,
  // they are not being served and should not be counted as revenue.
  const billable = merchants.filter((m) => m.status !== "suspended");
  const withFee = billable.filter((m) => m.monthlyFeeCents !== null);

  const healthCounts = new Map<AdminHealthFlag, number>(
    ADMIN_HEALTH_SEVERITY.map((f) => [f, 0])
  );
  for (const m of merchants) {
    const flag = primaryHealthFlag(m.flags);
    healthCounts.set(flag, (healthCounts.get(flag) ?? 0) + 1);
  }

  // YEARWEEK with mode 3 is ISO-8601 (Monday start, week 1 contains the first
  // Thursday), which is what "last 12 weeks" should mean for a Dutch business.
  // The label is the Monday of each week so the UI never has to decode a week
  // number.
  const [weekRows] = await pool.query<WeekRow[]>(
    `SELECT DATE_FORMAT(DATE_SUB(DATE(created_at),
              INTERVAL WEEKDAY(created_at) DAY), '%Y-%m-%d') AS week_start,
            COUNT(*) AS n
       FROM merchants
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ${WEEKS} WEEK)
      GROUP BY week_start
      ORDER BY week_start ASC`
  );

  // Gap-fill, so a week with no signups is a visible zero rather than a hole
  // that compresses the axis and makes a flat stretch look like growth.
  const weeks = new Map<string, number>();
  const now = new Date();
  const mondayOffset = (now.getUTCDay() + 6) % 7;
  const thisMonday = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - mondayOffset
  );
  for (let i = WEEKS - 1; i >= 0; i -= 1) {
    weeks.set(new Date(thisMonday - i * 7 * 86_400_000).toISOString().slice(0, 10), 0);
  }
  for (const row of weekRows) {
    if (weeks.has(row.week_start)) weeks.set(row.week_start, Number(row.n));
  }

  return res.json({
    merchants: {
      total: merchants.length,
      active: merchants.filter((m) => m.status === "active").length,
      trial: merchants.filter((m) => m.status === "trial").length,
      suspended: merchants.filter((m) => m.status === "suspended").length,
      trialsEndingSoon: merchants.filter(
        (m) => m.trial.daysLeft !== null && !m.trial.expired && m.trial.daysLeft <= 7
      ).length,
    },
    revenue: {
      mrrCents: withFee.reduce((acc, m) => acc + (m.monthlyFeeCents ?? 0), 0),
      feeSet: withFee.length,
      // Reported next to the total on purpose: with no billing integration
      // this number is only as complete as what has been typed in, and a bare
      // figure would read as the whole picture.
      feeUnset: billable.length - withFee.length,
    },
    usage: {
      customers: sum((m) => m.customers),
      cards: sum((m) => m.cards),
      walletCards: sum((m) => m.walletCards),
      googlePasses: sum((m) => m.googlePasses),
      applePasses: sum((m) => m.applePasses),
      eventsWindow: sum((m) => m.eventsWindow),
      eventsTotal: sum((m) => m.eventsTotal),
      merchantRevenueCentsWindow: sum((m) => m.revenueCentsWindow),
    },
    health: ADMIN_HEALTH_SEVERITY.map((flag) => ({
      flag,
      merchants: healthCounts.get(flag) ?? 0,
    })),
    signupsByWeek: Array.from(weeks.entries()).map(([weekStart, n]) => ({
      weekStart,
      merchants: n,
    })),
  });
});
