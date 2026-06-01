import { Router, type Request, type Response } from "express";
import type { RowDataPacket } from "mysql2";
import {
  BroadcastCreateInput,
  type Broadcast,
  type MessageDelivery,
} from "@stampdeck/shared";
import { pool } from "../db/pool.js";
import { authContext, requireAuth } from "../auth/middleware.js";
import { ApiError } from "../errors.js";
import { retrySource, startBroadcast } from "../messaging/operations.js";

export const broadcastsRouter: Router = Router();

interface BroadcastRow extends RowDataPacket {
  id: string;
  merchant_id: string;
  header: string;
  body: string;
  status: Broadcast["status"];
  scanned: number;
  sent: number;
  failed: number;
  started_at: Date;
  finished_at: Date | null;
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

function rowToBroadcast(row: BroadcastRow): Broadcast {
  return {
    id: row.id,
    merchantId: row.merchant_id,
    header: row.header,
    body: row.body,
    status: row.status,
    scanned: row.scanned,
    sent: row.sent,
    failed: row.failed,
    startedAt: new Date(row.started_at).toISOString(),
    finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : null,
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

interface PremiumRow extends RowDataPacket {
  is_premium: number;
}

async function requirePremium(merchantId: string): Promise<void> {
  const [rows] = await pool.execute<PremiumRow[]>(
    "SELECT is_premium FROM merchants WHERE id = ? LIMIT 1",
    [merchantId]
  );
  if (rows.length === 0 || !rows[0].is_premium) {
    throw new ApiError(
      402,
      "premium_required",
      "messaging is a premium feature — unlock to use"
    );
  }
}

// POST /v1/broadcasts — fire a broadcast (async). Premium-only.
broadcastsRouter.post(
  "/",
  requireAuth,
  async (req: Request, res: Response<{ broadcastId: string }>) => {
    const ctx = authContext(req);
    await requirePremium(ctx.merchantId);
    const input = BroadcastCreateInput.parse(req.body);
    const id = await startBroadcast(ctx.merchantId, input.header, input.body);
    return res.status(202).json({ broadcastId: id });
  }
);

// GET /v1/broadcasts — list this merchant's broadcasts (most recent first).
broadcastsRouter.get(
  "/",
  requireAuth,
  async (req: Request, res: Response<{ broadcasts: Broadcast[] }>) => {
    const ctx = authContext(req);
    const [rows] = await pool.execute<BroadcastRow[]>(
      `SELECT id, merchant_id, header, body, status, scanned, sent, failed,
              started_at, finished_at
         FROM broadcasts
        WHERE merchant_id = ?
        ORDER BY started_at DESC
        LIMIT 50`,
      [ctx.merchantId]
    );
    return res.json({ broadcasts: rows.map(rowToBroadcast) });
  }
);

// GET /v1/broadcasts/:id — single broadcast + per-card delivery list.
broadcastsRouter.get(
  "/:id",
  requireAuth,
  async (
    req: Request,
    res: Response<{ broadcast: Broadcast; deliveries: MessageDelivery[] }>
  ) => {
    const ctx = authContext(req);
    const [rows] = await pool.execute<BroadcastRow[]>(
      `SELECT id, merchant_id, header, body, status, scanned, sent, failed,
              started_at, finished_at
         FROM broadcasts
        WHERE id = ? AND merchant_id = ?
        LIMIT 1`,
      [req.params.id, ctx.merchantId]
    );
    if (rows.length === 0) throw ApiError.notFound("broadcast not found");

    const [deliveries] = await pool.execute<DeliveryRow[]>(
      `SELECT md.id, md.source_type, md.source_id, md.merchant_id, md.card_id,
              md.customer_id, md.status, md.attempts, md.last_error,
              md.last_attempt_at, md.created_at,
              cu.name AS customer_name, p.name AS program_name
         FROM message_deliveries md
         JOIN loyalty_cards c ON c.id = md.card_id
         JOIN loyalty_programs p ON p.id = c.program_id
         JOIN customers cu ON cu.id = md.customer_id
        WHERE md.source_type = 'broadcast' AND md.source_id = ?
        ORDER BY md.id ASC`,
      [req.params.id]
    );

    return res.json({
      broadcast: rowToBroadcast(rows[0]),
      deliveries: deliveries.map(rowToDelivery),
    });
  }
);

// POST /v1/broadcasts/:id/retry — re-attempt failed deliveries.
broadcastsRouter.post(
  "/:id/retry",
  requireAuth,
  async (
    req: Request,
    res: Response<{ retried: number; sent: number; failed: number }>
  ) => {
    const ctx = authContext(req);
    const [rows] = await pool.execute<BroadcastRow[]>(
      `SELECT header, body FROM broadcasts WHERE id = ? AND merchant_id = ? LIMIT 1`,
      [req.params.id, ctx.merchantId]
    );
    if (rows.length === 0) throw ApiError.notFound("broadcast not found");
    const result = await retrySource("broadcast", req.params.id, ctx.merchantId, {
      header: rows[0].header,
      body: rows[0].body,
    });
    return res.json(result);
  }
);
