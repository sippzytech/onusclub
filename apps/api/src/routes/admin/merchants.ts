// Cross-tenant merchant list and detail.
//
// Mounted behind requireAuth + requirePlatformAdmin in src/index.ts. Nothing
// in this file re-checks authorization, and nothing in it scopes by merchant —
// both are deliberate, and both are why the file is in this directory.

import { Router, type Request, type Response } from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { Pool, PoolConnection } from "mysql2/promise";
import {
  ADMIN_HEALTH_SEVERITY,
  ADMIN_HEALTH_THRESHOLDS,
  AdminMerchantPatch,
  AdminPasswordResetInput,
  DEFAULT_RFM_THRESHOLDS,
  classifyRfm,
  primaryHealthFlag,
  type AdminMerchantDetail,
  type AdminMerchantList,
  type AdminMerchantProgram,
  type AdminMerchantStaff,
  type AdminMerchantSummary,
  type AdminPasswordResetResult,
  type AdminHealthFlag,
  type RfmSegment,
  type RfmSegmentSummary,
} from "@onusclub/shared";
import { pool } from "../../db/pool.js";
import { ApiError } from "../../errors.js";
import { env } from "../../config.js";
import { logger } from "../../logger.js";
import { adminContext } from "../../admin/authorize.js";
import { writeAuditLog, writeAuditLogPooled } from "../../admin/audit.js";
import { issueMagicLink } from "../../auth/magic-link.js";
import { sendEmail } from "../../email/client.js";
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

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

interface MerchantStateRow extends RowDataPacket {
  business_name: string;
  owner_email: string;
  status: string;
  is_premium: number;
  crons_enabled: number;
  trial_ends_at: Date | null;
  monthly_fee_cents: number | null;
}

async function loadMerchantState(
  exec: Pool | PoolConnection,
  merchantId: string
): Promise<MerchantStateRow> {
  const [rows] = await exec.execute<MerchantStateRow[]>(
    `SELECT business_name, owner_email, status, is_premium, crons_enabled,
            trial_ends_at, monthly_fee_cents
       FROM merchants WHERE id = ? LIMIT 1`,
    [merchantId]
  );
  if (rows.length === 0) throw ApiError.notFound("merchant not found");
  return rows[0];
}

function snapshot(row: MerchantStateRow): Record<string, unknown> {
  return {
    businessName: row.business_name,
    status: row.status,
    isPremium: Boolean(row.is_premium),
    cronsEnabled: Boolean(row.crons_enabled),
    trialEndsAt: row.trial_ends_at ? row.trial_ends_at.toISOString() : null,
    monthlyFeeCents: row.monthly_fee_cents,
  };
}

/**
 * PATCH /v1/admin/merchants/:id
 *
 * There is deliberately no DELETE. The cascade from `merchants` reaches
 * customers, cards, events and points batches, and is irreversible — while
 * `status = 'suspended'` covers every real need and can be undone.
 *
 * Runs in a transaction with the audit row, so the before/after snapshot
 * cannot disagree with what was actually written, and a change that fails to
 * audit cannot commit.
 */
adminMerchantsRouter.patch("/:id", async (req: Request, res: Response<AdminMerchantSummary>) => {
  const actor = adminContext(req);
  const input = AdminMerchantPatch.parse(req.body);
  const merchantId = req.params.id;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const before = await loadMerchantState(conn, merchantId);

    const sets: string[] = [];
    const params: (string | number | boolean | Date | null)[] = [];
    if (input.businessName !== undefined) {
      sets.push("business_name = ?");
      params.push(input.businessName);
    }
    if (input.status !== undefined) {
      sets.push("status = ?");
      params.push(input.status);
    }
    if (input.isPremium !== undefined) {
      sets.push("is_premium = ?");
      params.push(input.isPremium);
    }
    if (input.cronsEnabled !== undefined) {
      sets.push("crons_enabled = ?");
      params.push(input.cronsEnabled);
    }
    if (input.trialEndsAt !== undefined) {
      sets.push("trial_ends_at = ?");
      // Explicit UTC string rather than a Date: mysql2's `timezone: 'Z'` is
      // set on the pool, but serialising the string makes the intent local to
      // this call rather than dependent on pool config.
      params.push(
        input.trialEndsAt === null
          ? null
          : new Date(input.trialEndsAt).toISOString().slice(0, 19).replace("T", " ")
      );
    }
    if (input.monthlyFeeCents !== undefined) {
      sets.push("monthly_fee_cents = ?");
      params.push(input.monthlyFeeCents);
    }

    params.push(merchantId);
    await conn.execute<ResultSetHeader>(
      `UPDATE merchants SET ${sets.join(", ")} WHERE id = ?`,
      params
    );

    const after = await loadMerchantState(conn, merchantId);

    // Read back rather than echoing the input, so the audit records what the
    // database actually holds — including any column that silently coerced.
    await writeAuditLog(conn, {
      actor,
      action: "merchant.update",
      merchantId,
      targetType: "merchant",
      targetId: merchantId,
      reason: input.reason,
      before: snapshot(before),
      after: snapshot(after),
    });

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  const updated = (await loadMerchantSummaries()).find((m) => m.id === merchantId);
  if (!updated) throw ApiError.notFound("merchant not found");
  return res.json(updated);
});

/**
 * POST /v1/admin/merchants/:id/password-reset
 *
 * Issues the ordinary reset link to the owner's own email address. Reuses
 * `issueMagicLink` and the same `/auth/reset-password` landing page as the
 * self-service flow — the point is to help an owner who is locked out, not to
 * create a second way into their account. We never see or set the password.
 */
adminMerchantsRouter.post(
  "/:id/password-reset",
  async (req: Request, res: Response<AdminPasswordResetResult>) => {
    const actor = adminContext(req);
    const input = AdminPasswordResetInput.parse(req.body);
    const merchantId = req.params.id;

    const merchant = await loadMerchantState(pool, merchantId);

    const [ownerRows] = await pool.execute<RowDataPacket[]>(
      `SELECT id, email FROM staff_users
        WHERE merchant_id = ? AND role = 'owner'
        ORDER BY created_at ASC LIMIT 1`,
      [merchantId]
    );
    if (ownerRows.length === 0) throw ApiError.notFound("this café has no owner account");
    const ownerId = ownerRows[0].id as string;
    const ownerEmail = ownerRows[0].email as string;

    const { url } = await issueMagicLink(ownerId);
    const resetUrl = url.replace("/auth/verify", "/auth/reset-password");

    void sendEmail({
      kind: "admin_password_reset",
      merchantId,
      to: ownerEmail,
      subject: "Reset your OnUsClub password",
      text:
        `We've been asked to help you back into your OnUsClub account.\n\n` +
        `Click this link to choose a new password:\n${resetUrl}\n\n` +
        `If you didn't expect this, ignore this email. The link expires in 1 hour.`,
      html:
        `<p>We&rsquo;ve been asked to help you back into your OnUsClub account.</p>` +
        `<p><a href="${resetUrl}">Choose a new password</a></p>` +
        `<p>If you didn&rsquo;t expect this, ignore this email. The link expires in 1 hour.</p>`,
    }).catch((err: unknown) =>
      logger.warn({ err, merchantId }, "admin-issued reset email failed")
    );

    // Not inside a transaction: issueMagicLink and sendEmail are not
    // transactional either, and a reset that happened must be recorded even if
    // the audit insert is the thing that fails. Logged rather than silently
    // dropped if it does.
    await writeAuditLogPooled({
      actor,
      action: "merchant.password_reset",
      merchantId,
      targetType: "staff_user",
      targetId: ownerId,
      reason: input.reason,
      before: { ownerEmail: merchant.owner_email },
      after: { sentTo: ownerEmail },
    });

    const result: AdminPasswordResetResult = { sentTo: ownerEmail };
    // Dev only — Resend is still in test mode and delivers to one address, so
    // without this the feature is untestable locally. Same affordance the
    // self-service forgot-password route already has.
    if (env.NODE_ENV !== "production") result.devResetLink = resetUrl;
    return res.json(result);
  }
);

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
