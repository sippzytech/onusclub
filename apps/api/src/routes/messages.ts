import { Router, type Request, type Response } from "express";
import type { RowDataPacket } from "mysql2";
import type { MessageFeedItem } from "@onusclub/shared";
import { pool } from "../db/pool.js";
import { authContext, requireAuth } from "../auth/middleware.js";

export const messagesRouter: Router = Router();

interface FeedRow extends RowDataPacket {
  kind: "broadcast" | "sweep";
  id: string;
  sweep_type: "birthday" | "inactivity" | null;
  header: string;
  body: string | null;
  status: "running" | "completed" | "failed";
  scanned: number;
  sent: number;
  failed: number;
  started_at: Date;
  finished_at: Date | null;
}

// Combined feed: broadcasts (merchant-scoped) + sweep runs (we filter sweeps
// to those that actually delivered to this merchant — empty sweeps with no
// deliveries for this merchant are uninteresting noise in the owner's UI).
messagesRouter.get(
  "/",
  requireAuth,
  async (req: Request, res: Response<{ items: MessageFeedItem[] }>) => {
    const ctx = authContext(req);
    const [rows] = await pool.execute<FeedRow[]>(
      `SELECT 'broadcast' AS kind, id, NULL AS sweep_type, header, body, status,
              scanned, sent, failed, started_at, finished_at
         FROM broadcasts WHERE merchant_id = ?
       UNION ALL
       SELECT 'sweep' AS kind, sr.id, sr.sweep_type AS sweep_type,
              CASE sr.sweep_type
                WHEN 'birthday' THEN 'Birthday sweep'
                WHEN 'inactivity' THEN 'Inactivity sweep'
              END AS header,
              NULL AS body, sr.status,
              -- Per-merchant numbers: how many of this merchant's customers
              -- the sweep touched. Sweep is global, but the owner only wants
              -- to see their slice.
              IFNULL(stats.scanned, 0) AS scanned,
              IFNULL(stats.sent, 0)    AS sent,
              IFNULL(stats.failed, 0)  AS failed,
              sr.started_at, sr.finished_at
         FROM sweep_runs sr
         LEFT JOIN (
            SELECT source_type, source_id,
                   COUNT(*) AS scanned,
                   SUM(status = 'sent')   AS sent,
                   SUM(status = 'failed') AS failed
              FROM message_deliveries
             WHERE merchant_id = ?
             GROUP BY source_type, source_id
         ) stats
           ON stats.source_type = sr.sweep_type AND stats.source_id = sr.id
        -- Surface only sweeps that touched at least one of this merchant's
        -- cards; otherwise the feed fills up with global empty runs.
        WHERE stats.scanned > 0
        ORDER BY started_at DESC
        LIMIT 50`,
      [ctx.merchantId, ctx.merchantId]
    );

    const items: MessageFeedItem[] = rows.map((r) => ({
      kind: r.kind,
      id: r.id,
      ...(r.sweep_type ? { sweepType: r.sweep_type } : {}),
      header: r.header,
      body: r.body,
      status: r.status,
      scanned: Number(r.scanned),
      sent: Number(r.sent),
      failed: Number(r.failed),
      startedAt: new Date(r.started_at).toISOString(),
      finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
    }));
    return res.json({ items });
  }
);
