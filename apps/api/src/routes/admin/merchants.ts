// Cross-tenant merchant list and detail.
//
// Mounted behind requireAuth + requirePlatformAdmin in src/index.ts. Nothing
// in this file re-checks authorization, and nothing in it scopes by merchant —
// both are deliberate, and both are why the file is in this directory.

import { Router, type Request, type Response } from "express";
import type { RowDataPacket } from "mysql2";
import {
  ADMIN_HEALTH_SEVERITY,
  ADMIN_HEALTH_THRESHOLDS,
  DEFAULT_RFM_THRESHOLDS,
  classifyRfm,
  primaryHealthFlag,
  type AdminMerchantDetail,
  type AdminMerchantList,
  type AdminMerchantProgram,
  type AdminMerchantStaff,
  type AdminHealthFlag,
  type RfmSegment,
  type RfmSegmentSummary,
} from "@onusclub/shared";
import { pool } from "../../db/pool.js";
import { ApiError } from "../../errors.js";
import { loadMerchantSummaries, SUMMARY_THRESHOLDS } from "../../admin/overview.js";
import { safeZone, localDayHour } from "../analytics.js";

export const adminMerchantsRouter: Router = Router();

const SEGMENT_ORDER: readonly RfmSegment[] = [
  "champions",
  "promising",
  "new",
  "at_risk",
  "sleeping",
  "lost",
];

/**
 * GET /v1/admin/merchants
 *
 * ?q=        substring match on business name, owner email or slug
 * ?status=   active | trial | suspended
 * ?flag=     only cafés carrying this health flag
 * ?sort=     attention (default) | newest | name | customers | revenue | fee
 *
 * Filtering and sorting happen here, on the assembled objects, rather than in
 * SQL. The sorts that matter are derived — health severity, sales per reward —
 * and no index can serve those; and at this scale the whole list is a few
 * dozen rows in memory.
 */
adminMerchantsRouter.get("/", async (req: Request, res: Response<AdminMerchantList>) => {
  let merchants = await loadMerchantSummaries();

  const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
  if (q) {
    merchants = merchants.filter(
      (m) =>
        m.businessName.toLowerCase().includes(q) ||
        m.ownerEmail.toLowerCase().includes(q) ||
        (m.publicSlug ?? "").toLowerCase().includes(q)
    );
  }

  const status = typeof req.query.status === "string" ? req.query.status : "";
  if (status === "active" || status === "trial" || status === "suspended") {
    merchants = merchants.filter((m) => m.status === status);
  }

  const flag = typeof req.query.flag === "string" ? (req.query.flag as AdminHealthFlag) : "";
  if (flag) merchants = merchants.filter((m) => m.flags.includes(flag));

  const sort = typeof req.query.sort === "string" ? req.query.sort : "attention";
  const severity = (m: { flags: AdminHealthFlag[] }): number =>
    ADMIN_HEALTH_SEVERITY.indexOf(primaryHealthFlag(m.flags));

  switch (sort) {
    case "newest":
      merchants.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      break;
    case "name":
      merchants.sort((a, b) => a.businessName.localeCompare(b.businessName));
      break;
    case "customers":
      merchants.sort((a, b) => b.customers - a.customers);
      break;
    case "revenue":
      merchants.sort((a, b) => b.revenueCentsWindow - a.revenueCentsWindow);
      break;
    case "fee":
      // Unset fees sort last rather than as zero — "nobody recorded this" is
      // not "this café pays nothing".
      merchants.sort((a, b) => (b.monthlyFeeCents ?? -1) - (a.monthlyFeeCents ?? -1));
      break;
    default:
      // Default view answers "who needs attention": worst flag first, and
      // within a flag the biggest café first, since a dormant café with 400
      // customers matters more than a dormant one with 3.
      merchants.sort(
        (a, b) => severity(a) - severity(b) || b.customers - a.customers
      );
  }

  return res.json({ thresholds: SUMMARY_THRESHOLDS, merchants });
});

interface ProgramRow extends RowDataPacket {
  id: string;
  name: string;
  program_type: string;
  reward_text: string;
  active: number;
  created_at: Date;
  cards: number;
}

interface StaffRow extends RowDataPacket {
  id: string;
  email: string;
  name: string | null;
  role: string;
  created_at: Date;
}

interface CustomerVisitRow extends RowDataPacket {
  customer_id: string;
  visits: number;
  revenue_cents: string | number | null;
  last_visit: Date | null;
}

interface EventRow extends RowDataPacket {
  id: number;
  card_id: string;
  customer_name: string | null;
  program_name: string;
  event_type: string;
  amount_cents: number | null;
  note: string | null;
  created_at: Date;
}

interface DayRow extends RowDataPacket {
  utc_day: string;
  events: number;
}

interface TzRow extends RowDataPacket {
  timezone: string | null;
}

/**
 * GET /v1/admin/merchants/:id
 *
 * Unlike the list, every query here IS scoped to one merchant — not for
 * isolation (the caller is already past the gate) but because it rides the
 * same (merchant_id, created_at) index the café's own dashboard uses.
 */
adminMerchantsRouter.get("/:id", async (req: Request, res: Response<AdminMerchantDetail>) => {
  const merchantId = req.params.id;

  // Reuses the platform-wide aggregate rather than recomputing one merchant's
  // numbers a second way. Two code paths for "how many dead enrolments" would
  // eventually disagree, and the list is the one people act on.
  const merchant = (await loadMerchantSummaries()).find((m) => m.id === merchantId);
  if (!merchant) throw ApiError.notFound("merchant not found");

  const [programRows] = await pool.execute<ProgramRow[]>(
    `SELECT p.id, p.name, p.program_type, p.reward_text, p.active, p.created_at,
            COUNT(c.id) AS cards
       FROM loyalty_programs p
       LEFT JOIN loyalty_cards c ON c.program_id = p.id
      WHERE p.merchant_id = ?
      GROUP BY p.id
      ORDER BY p.created_at ASC`,
    [merchantId]
  );

  const [staffRows] = await pool.execute<StaffRow[]>(
    `SELECT id, email, name, role, created_at
       FROM staff_users
      WHERE merchant_id = ?
      ORDER BY role DESC, created_at ASC`,
    [merchantId]
  );

  // Same classifier the café sees on its own analytics page, so our view of
  // "at risk" and theirs cannot drift. Enrolled-but-never-visited customers
  // are excluded: they have no recency to measure, and forcing them into a
  // bucket would make every café look like it was haemorrhaging customers.
  const [visitRows] = await pool.execute<CustomerVisitRow[]>(
    `SELECT c.customer_id,
            COUNT(*)                        AS visits,
            SUM(COALESCE(e.amount_cents, 0)) AS revenue_cents,
            MAX(e.created_at)               AS last_visit
       FROM card_events e
       JOIN loyalty_cards c ON c.id = e.card_id
      WHERE e.merchant_id = ?
        AND e.event_type IN ('stamp', 'redeem', 'points_add', 'review_reward')
      GROUP BY c.customer_id`,
    [merchantId]
  );

  const segmentTotals = new Map<RfmSegment, RfmSegmentSummary>(
    SEGMENT_ORDER.map((s) => [s, { segment: s, customers: 0, revenueCents: 0 }])
  );
  for (const row of visitRows) {
    if (!row.last_visit) continue;
    const days = Math.max(
      0,
      Math.floor((Date.now() - new Date(row.last_visit).getTime()) / 86_400_000)
    );
    const segment = classifyRfm(days, Number(row.visits), DEFAULT_RFM_THRESHOLDS);
    const bucket = segmentTotals.get(segment)!;
    bucket.customers += 1;
    bucket.revenueCents += Number(row.revenue_cents ?? 0);
  }

  const [tzRows] = await pool.execute<TzRow[]>(
    "SELECT timezone FROM merchants WHERE id = ? LIMIT 1",
    [merchantId]
  );
  const timeZone = safeZone(tzRows[0]?.timezone ?? null);

  const windowDays = ADMIN_HEALTH_THRESHOLDS.windowDays;
  const startMs = Date.now() - windowDays * 86_400_000;
  const startSql = new Date(startMs).toISOString().slice(0, 19).replace("T", " ");

  // Grouped by UTC day in SQL, re-bucketed into the merchant's own days in
  // Node — the same two-step the café's analytics page uses, and for the same
  // reason: CONVERT_TZ needs MySQL's timezone tables loaded, which the
  // official image does not ship.
  const [dayRows] = await pool.execute<DayRow[]>(
    `SELECT DATE_FORMAT(created_at, '%Y-%m-%dT%H:00:00.000Z') AS utc_day,
            COUNT(*) AS events
       FROM card_events
      WHERE merchant_id = ?
        AND created_at >= ?
        AND event_type IN ('stamp', 'redeem', 'points_add', 'review_reward')
      GROUP BY utc_day`,
    [merchantId, startSql]
  );

  const daily = new Map<string, number>();
  for (let i = 0; i <= windowDays; i += 1) {
    // Anchored at midday so a DST transition cannot land the probe on the
    // wrong calendar date.
    const { date } = localDayHour(new Date(startMs + i * 86_400_000 + 43_200_000), timeZone);
    if (!daily.has(date)) daily.set(date, 0);
  }
  for (const row of dayRows) {
    const { date } = localDayHour(new Date(row.utc_day), timeZone);
    daily.set(date, (daily.get(date) ?? 0) + Number(row.events));
  }

  const [eventRows] = await pool.execute<EventRow[]>(
    `SELECT e.id, e.card_id, e.event_type, e.amount_cents, e.note, e.created_at,
            cu.name AS customer_name,
            p.name  AS program_name
       FROM card_events e
       JOIN loyalty_cards c    ON c.id = e.card_id
       JOIN customers cu       ON cu.id = c.customer_id
       JOIN loyalty_programs p ON p.id = c.program_id
      WHERE e.merchant_id = ?
      ORDER BY e.id DESC
      LIMIT 40`,
    [merchantId]
  );

  const programs: AdminMerchantProgram[] = programRows.map((p) => ({
    id: p.id,
    name: p.name,
    programType: p.program_type,
    rewardText: p.reward_text,
    active: Boolean(p.active),
    cards: Number(p.cards),
    createdAt: p.created_at.toISOString(),
  }));

  const staff: AdminMerchantStaff[] = staffRows.map((s) => ({
    id: s.id,
    email: s.email,
    name: s.name,
    role: s.role,
    createdAt: s.created_at.toISOString(),
  }));

  return res.json({
    merchant,
    thresholds: SUMMARY_THRESHOLDS,
    programs,
    staff,
    segments: SEGMENT_ORDER.map((s) => segmentTotals.get(s)!),
    daily: Array.from(daily.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, events]) => ({ date, events })),
    recentEvents: eventRows.map((e) => ({
      id: Number(e.id),
      cardId: e.card_id,
      customerName: e.customer_name,
      programName: e.program_name,
      eventType: e.event_type,
      amountCents: e.amount_cents === null ? null : Number(e.amount_cents),
      createdAt: e.created_at.toISOString(),
      note: e.note,
    })),
  });
});
