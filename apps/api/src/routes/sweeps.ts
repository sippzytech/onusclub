import { Router, type Request, type Response } from "express";
import type { RowDataPacket } from "mysql2";
import {
  type MessageDelivery,
  type SweepRun,
  type SweepType,
} from "@onusclub/shared";
import { pool } from "../db/pool.js";
import { authContext, requireAuth } from "../auth/middleware.js";
import { ApiError } from "../errors.js";
import { env } from "../config.js";
import {
  retrySource,
  runBirthdaySweep,
  runExpirySweep,
  runInactivitySweep,
  runPointsExpirySweep,
} from "../messaging/operations.js";

export const sweepsRouter: Router = Router();

interface SweepRow extends RowDataPacket {
  id: string;
  sweep_type: SweepType;
  status: SweepRun["status"];
  scanned: number;
  sent: number;
  failed: number;
  started_at: Date;
  finished_at: Date | null;
  error_message: string | null;
}

interface DeliveryRow extends RowDataPacket {
  id: number;
  source_type: MessageDelivery["sourceType"];
  source_id: string;
  merchant_id: string;
  card_id: string;
  customer_id: string;
  customer_name: string | null;
  program_name: string;
  status: MessageDelivery["status"];
  attempts: number;
  last_error: string | null;
  last_attempt_at: Date | null;
  created_at: Date;
}

function rowToSweep(row: SweepRow): SweepRun {
  return {
    id: row.id,
    sweepType: row.sweep_type,
    status: row.status,
    scanned: row.scanned,
    sent: row.sent,
    failed: row.failed,
    startedAt: new Date(row.started_at).toISOString(),
    finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : null,
    errorMessage: row.error_message,
  };
}

function rowToDelivery(row: DeliveryRow): MessageDelivery {
  return {
    id: row.id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    merchantId: row.merchant_id,
    cardId: row.card_id,
    customerId: row.customer_id,
    customerName: row.customer_name,
    programName: row.program_name,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    lastAttemptAt: row.last_attempt_at ? new Date(row.last_attempt_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

// GET /v1/sweeps — recent cron runs, with counters scoped to this merchant.
//
// sweep_runs has no merchant_id, and correctly so: a sweep is one platform-wide
// cron pass over every tenant. But that means its own scanned/sent/failed
// columns are platform totals, and returning them told each merchant how much
// traffic every OTHER merchant had — a café with ten customers reading
// "scanned 500". A cross-tenant leak, and wrong from their point of view too.
//
// The counters are therefore recomputed from message_deliveries, which does
// carry merchant_id. Runs that touched nobody here are still listed, with
// zeroes: "the sweep ran, none of yours were eligible" is useful, and hiding
// them would look like the crons had stopped.
sweepsRouter.get(
  "/",
  requireAuth,
  async (req: Request, res: Response<{ sweeps: SweepRun[] }>) => {
    const ctx = authContext(req);
    const [rows] = await pool.execute<SweepRow[]>(
      `SELECT s.id, s.sweep_type, s.status,
              COUNT(md.id)                                      AS scanned,
              COALESCE(SUM(md.status = 'sent'), 0)              AS sent,
              COALESCE(SUM(md.status = 'failed'), 0)            AS failed,
              s.started_at, s.finished_at, s.error_message
         FROM sweep_runs s
         LEFT JOIN message_deliveries md
                ON md.source_type = s.sweep_type
               AND md.source_id = s.id
               AND md.merchant_id = ?
        GROUP BY s.id, s.sweep_type, s.status, s.started_at, s.finished_at, s.error_message
        ORDER BY s.started_at DESC
        LIMIT 50`,
      [ctx.merchantId]
    );
    return res.json({ sweeps: rows.map(rowToSweep) });
  }
);

// GET /v1/sweeps/:id — detail with per-card deliveries scoped to this merchant.
sweepsRouter.get(
  "/:id",
  requireAuth,
  async (
    req: Request,
    res: Response<{ sweep: SweepRun; deliveries: MessageDelivery[] }>
  ) => {
    const ctx = authContext(req);
    // Same scoping as the list: the run's own columns are platform totals.
    const [rows] = await pool.execute<SweepRow[]>(
      `SELECT s.id, s.sweep_type, s.status,
              COUNT(md.id)                           AS scanned,
              COALESCE(SUM(md.status = 'sent'), 0)   AS sent,
              COALESCE(SUM(md.status = 'failed'), 0) AS failed,
              s.started_at, s.finished_at, s.error_message
         FROM sweep_runs s
         LEFT JOIN message_deliveries md
                ON md.source_type = s.sweep_type
               AND md.source_id = s.id
               AND md.merchant_id = ?
        WHERE s.id = ?
        GROUP BY s.id, s.sweep_type, s.status, s.started_at, s.finished_at, s.error_message
        LIMIT 1`,
      [ctx.merchantId, req.params.id]
    );
    if (rows.length === 0) throw ApiError.notFound("sweep run not found");
    const sweep = rowToSweep(rows[0]);

    const [deliveries] = await pool.execute<DeliveryRow[]>(
      `SELECT md.id, md.source_type, md.source_id, md.merchant_id, md.card_id,
              md.customer_id, md.status, md.attempts, md.last_error,
              md.last_attempt_at, md.created_at,
              cu.name AS customer_name, p.name AS program_name
         FROM message_deliveries md
         JOIN loyalty_cards c ON c.id = md.card_id
         JOIN loyalty_programs p ON p.id = c.program_id
         JOIN customers cu ON cu.id = md.customer_id
        WHERE md.source_type = ? AND md.source_id = ? AND md.merchant_id = ?
        ORDER BY md.id ASC`,
      [sweep.sweepType, sweep.id, ctx.merchantId]
    );

    return res.json({ sweep, deliveries: deliveries.map(rowToDelivery) });
  }
);

// POST /v1/sweeps/:id/retry — retry this merchant's failed deliveries.
sweepsRouter.post(
  "/:id/retry",
  requireAuth,
  async (
    req: Request,
    res: Response<{ retried: number; sent: number; failed: number }>
  ) => {
    const ctx = authContext(req);
    const [rows] = await pool.execute<SweepRow[]>(
      `SELECT sweep_type FROM sweep_runs WHERE id = ? LIMIT 1`,
      [req.params.id]
    );
    if (rows.length === 0) throw ApiError.notFound("sweep run not found");
    const result = await retrySource(rows[0].sweep_type, req.params.id, ctx.merchantId);
    return res.json(result);
  }
);

// POST /v1/sweeps/run/:type — dev / staging only: trigger a sweep right now
// instead of waiting for cron. Useful for smoke tests and manual demos.
sweepsRouter.post(
  "/run/:type",
  requireAuth,
  async (
    req: Request,
    res: Response<
      | { id: string; scanned: number; sent: number; failed: number }
      | { scanned: number; expired: number }
    >
  ) => {
    if (env.NODE_ENV === "production") {
      throw ApiError.notFound("not available in production");
    }
    const type = req.params.type;
    if (type === "birthday") return res.json(await runBirthdaySweep());
    if (type === "inactivity") return res.json(await runInactivitySweep());
    if (type === "expiry") return res.json(await runExpirySweep());
    if (type === "points-expiry") return res.json(await runPointsExpirySweep());
    throw ApiError.badRequest("unknown sweep type");
  }
);
