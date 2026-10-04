// Reading back what happened to a merchant's email.
//
// Shared by the merchant dashboard (their own sends) and the admin dashboard
// (platform-wide), so the two cannot disagree about what "failed" means.

import type { RowDataPacket } from "mysql2";
import type { EmailDelivery, EmailHealth } from "@onusclub/shared";
import { pool } from "../db/pool.js";

/** Matches the analytics convention elsewhere in the product. */
export const EMAIL_HEALTH_WINDOW_DAYS = 30;

/** Enough to see a pattern. This is a health panel, not a log viewer. */
const RECENT_FAILURE_LIMIT = 20;

interface CountRow extends RowDataPacket {
  status: "sent" | "failed" | "skipped";
  n: number;
}

interface DeliveryRow extends RowDataPacket {
  id: number;
  kind: string;
  to_email: string;
  subject: string;
  status: "sent" | "failed" | "skipped";
  error: string | null;
  customer_id: string | null;
  card_id: string | null;
  created_at: Date;
}

function rowToDelivery(r: DeliveryRow): EmailDelivery {
  return {
    id: Number(r.id),
    kind: r.kind,
    toEmail: r.to_email,
    subject: r.subject,
    status: r.status,
    error: r.error,
    customerId: r.customer_id,
    cardId: r.card_id,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

/**
 * Email outcomes over the window.
 *
 * `merchantId` null means platform-wide, for the admin dashboard — including
 * the lead notifications that belong to no tenant. A merchant's own view never
 * passes null.
 */
export async function loadEmailHealth(merchantId: string | null): Promise<EmailHealth> {
  const scope = merchantId ? "AND merchant_id = ?" : "";
  const params = merchantId ? [merchantId] : [];

  const [countRows] = await pool.execute<CountRow[]>(
    `SELECT status, COUNT(*) AS n
       FROM email_deliveries
      WHERE created_at >= NOW() - INTERVAL ${EMAIL_HEALTH_WINDOW_DAYS} DAY
        ${scope}
      GROUP BY status`,
    params
  );

  const counts = { sent: 0, failed: 0, skipped: 0 };
  for (const row of countRows) counts[row.status] = Number(row.n);

  const [failureRows] = await pool.execute<DeliveryRow[]>(
    `SELECT id, kind, to_email, subject, status, error, customer_id, card_id, created_at
       FROM email_deliveries
      WHERE status = 'failed'
        AND created_at >= NOW() - INTERVAL ${EMAIL_HEALTH_WINDOW_DAYS} DAY
        ${scope}
      ORDER BY id DESC
      LIMIT ${RECENT_FAILURE_LIMIT}`,
    params
  );

  return {
    windowDays: EMAIL_HEALTH_WINDOW_DAYS,
    ...counts,
    recentFailures: failureRows.map(rowToDelivery),
  };
}

/**
 * Every recorded send for one customer, newest first.
 *
 * The actual support question — "my customer says they never got their card" —
 * answered on the card page instead of by grepping logs on the VPS.
 */
export async function loadCustomerEmails(
  customerId: string,
  merchantId: string
): Promise<EmailDelivery[]> {
  const [rows] = await pool.execute<DeliveryRow[]>(
    `SELECT id, kind, to_email, subject, status, error, customer_id, card_id, created_at
       FROM email_deliveries
      WHERE customer_id = ? AND merchant_id = ?
      ORDER BY id DESC
      LIMIT 20`,
    [customerId, merchantId]
  );
  return rows.map(rowToDelivery);
}
