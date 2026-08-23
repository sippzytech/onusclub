// Day 15: the numbers behind the Overview page.
//
// Everything monetary here derives from card_events.amount_cents — the sale
// amount a merchant optionally types at scan time. We have no POS
// integration and do not plan one; see PERKSTAR_ANALYSIS.md for why that
// trade is the right one for our user base.

import { Router, type Request, type Response } from "express";
import type { RowDataPacket } from "mysql2";
import type { ActivityEvent, AnalyticsOverview } from "@onusclub/shared";
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
