// The operator-side audit trail: everything the master dashboard has written.
//
// Read-only, and there is deliberately no delete or edit path — not from the
// API and not from the UI. An audit log that can be tidied up is not one.
//
// Note this is the *second* of two layers. Balance adjustments also land in
// `card_events` as `manual_adjust`, where the merchant sees them on their own
// dashboard; that is the layer that actually keeps us honest. This one covers
// what card_events cannot: suspending a café, changing a fee, forcing a
// password reset.

import { Router, type Request, type Response } from "express";
import type { RowDataPacket } from "mysql2";
import type { AdminAuditLog } from "@onusclub/shared";
import { pool } from "../../db/pool.js";

export const adminAuditRouter: Router = Router();

const PAGE_SIZE = 100;

interface AuditRow extends RowDataPacket {
  id: number;
  actor_email: string;
  action: string;
  merchant_id: string | null;
  merchant_name: string | null;
  target_type: string | null;
  target_id: string | null;
  reason: string;
  before_json: unknown;
  after_json: unknown;
  created_at: Date;
}

function parseJson(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * GET /v1/admin/audit?merchantId=&action=
 *
 * `merchant_name` comes from a LEFT JOIN, not from the log: the log has no FK
 * on `merchant_id` so that it outlives what it describes. A null name
 * therefore means "that café no longer exists", which is exactly the case you
 * most want the record of.
 */
adminAuditRouter.get("/", async (req: Request, res: Response<AdminAuditLog>) => {
  const where: string[] = [];
  const params: string[] = [];
  if (typeof req.query.merchantId === "string" && req.query.merchantId) {
    where.push("a.merchant_id = ?");
    params.push(req.query.merchantId);
  }
  if (typeof req.query.action === "string" && req.query.action) {
    where.push("a.action = ?");
    params.push(req.query.action);
  }

  const [rows] = await pool.execute<AuditRow[]>(
    `SELECT a.id, a.actor_email, a.action, a.merchant_id, a.target_type,
            a.target_id, a.reason, a.before_json, a.after_json, a.created_at,
            m.business_name AS merchant_name
       FROM admin_audit_log a
       LEFT JOIN merchants m ON m.id = a.merchant_id
      ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY a.id DESC
      LIMIT ${PAGE_SIZE + 1}`,
    params
  );

  return res.json({
    entries: rows.slice(0, PAGE_SIZE).map((r) => ({
      id: Number(r.id),
      actorEmail: r.actor_email,
      action: r.action,
      merchantId: r.merchant_id,
      merchantName: r.merchant_name,
      targetType: r.target_type,
      targetId: r.target_id,
      reason: r.reason,
      before: parseJson(r.before_json),
      after: parseJson(r.after_json),
      createdAt: new Date(r.created_at).toISOString(),
    })),
    truncated: rows.length > PAGE_SIZE,
  });
});
