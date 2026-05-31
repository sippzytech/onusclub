// Broadcast + birthday + inactivity messaging. All three share:
//   1. a `*_runs` row to track scanned/sent/failed totals + duration
//   2. one `message_deliveries` row per candidate card (status pending → sent/failed)
//   3. the same per-card send via wallet/loyalty.sendCustomCardMessage
// Broadcasts are owner-triggered (kicked off by the route handler). Birthday
// and inactivity are cron-triggered (node-cron). The "engine" below is the
// same in all cases — only the candidate query + message copy differ.

import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { pool } from "../db/pool.js";
import { logger } from "../logger.js";
import { sendCustomCardMessage } from "../wallet/loyalty.js";

const INACTIVITY_DAYS = 30;
const SEND_CONCURRENCY = 5;
const MAX_ATTEMPTS = 3;

type SourceType = "broadcast" | "birthday" | "inactivity";

interface CandidateRow extends RowDataPacket {
  card_id: string;
  merchant_id: string;
  customer_id: string;
  business_name: string;
  customer_name: string | null;
  reward_text: string;
  program_config: unknown;
}

interface DeliveryRow extends RowDataPacket {
  id: number;
  card_id: string;
  merchant_id: string;
  customer_id: string;
  attempts: number;
  status: "pending" | "sent" | "failed";
  business_name: string;
  customer_name: string | null;
  reward_text: string;
  program_config: unknown;
}

function parseJson<T>(value: unknown): T {
  return typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
}

interface MessageRenderer {
  (row: CandidateRow): { header: string; body: string };
}

interface Counters {
  sent: number;
  failed: number;
}

/**
 * Process a list of candidate cards with a fixed concurrency budget. For each
 * card: insert/find the message_deliveries row, render the message, call
 * wallet, update the delivery row with the outcome.
 */
async function dispatch(
  sourceType: SourceType,
  sourceId: string,
  candidates: CandidateRow[],
  render: MessageRenderer
): Promise<Counters> {
  const counters: Counters = { sent: 0, failed: 0 };
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < candidates.length) {
      const c = candidates[cursor++];
      const { header, body } = render(c);
      // We always insert a fresh delivery row for each attempt to keep an
      // accurate audit trail; the broadcast/sweep totals roll the latest
      // per (source, card) into the displayed numbers via UI joins.
      const [insertResult] = await pool.execute<ResultSetHeader>(
        `INSERT INTO message_deliveries
           (source_type, source_id, merchant_id, card_id, customer_id, status, attempts)
         VALUES (?, ?, ?, ?, ?, 'pending', 0)`,
        [sourceType, sourceId, c.merchant_id, c.card_id, c.customer_id]
      );
      const deliveryId = insertResult.insertId;

      const result = await sendCustomCardMessage({ cardId: c.card_id, header, body });
      if (result.ok) {
        counters.sent += 1;
        await pool.execute(
          `UPDATE message_deliveries
              SET status = 'sent', attempts = attempts + 1,
                  last_attempt_at = CURRENT_TIMESTAMP, last_error = NULL
            WHERE id = ?`,
          [deliveryId]
        );
      } else {
        counters.failed += 1;
        await pool.execute(
          `UPDATE message_deliveries
              SET status = 'failed', attempts = attempts + 1,
                  last_attempt_at = CURRENT_TIMESTAMP, last_error = ?
            WHERE id = ?`,
          [(result.error ?? "unknown error").slice(0, 500), deliveryId]
        );
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(SEND_CONCURRENCY, candidates.length) }, () => worker())
  );
  return counters;
}

// ---------- Broadcast ----------

/**
 * Start a broadcast. Creates the broadcasts row immediately, returns the id,
 * and kicks the dispatch loop into the background so the HTTP request can
 * return quickly. Status moves to 'completed' (or 'failed') when the loop
 * finishes.
 */
export async function startBroadcast(
  merchantId: string,
  header: string,
  body: string
): Promise<string> {
  const id = randomUUID();
  await pool.execute<ResultSetHeader>(
    `INSERT INTO broadcasts (id, merchant_id, header, body, status)
     VALUES (?, ?, ?, ?, 'running')`,
    [id, merchantId, header, body]
  );

  // Fire-and-forget background processing. Errors are caught + logged so the
  // process never unhandled-rejects.
  void runBroadcast(id, merchantId, header, body).catch((err: unknown) => {
    logger.error({ err, broadcastId: id }, "broadcast crashed");
  });

  return id;
}

async function runBroadcast(
  id: string,
  merchantId: string,
  header: string,
  body: string
): Promise<void> {
  try {
    const [candidates] = await pool.execute<CandidateRow[]>(
      `SELECT c.id AS card_id, c.merchant_id, c.customer_id,
              m.business_name,
              cu.name AS customer_name,
              p.reward_text, p.config_json AS program_config
         FROM loyalty_cards c
         JOIN merchants m ON m.id = c.merchant_id
         JOIN customers cu ON cu.id = c.customer_id
         JOIN loyalty_programs p ON p.id = c.program_id
        WHERE c.merchant_id = ? AND c.status = 'active'`,
      [merchantId]
    );
    await pool.execute("UPDATE broadcasts SET scanned = ? WHERE id = ?", [
      candidates.length,
      id,
    ]);

    const counters = await dispatch("broadcast", id, candidates, () => ({ header, body }));

    await pool.execute(
      `UPDATE broadcasts
          SET sent = ?, failed = ?, status = 'completed', finished_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [counters.sent, counters.failed, id]
    );
    logger.info(
      { broadcastId: id, ...counters, scanned: candidates.length },
      "broadcast complete"
    );
  } catch (err) {
    logger.error({ err, broadcastId: id }, "broadcast failed");
    await pool.execute(
      `UPDATE broadcasts SET status = 'failed', finished_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [id]
    );
  }
}

// ---------- Sweeps ----------

interface SweepResult {
  id: string;
  scanned: number;
  sent: number;
  failed: number;
}

export async function runBirthdaySweep(): Promise<SweepResult> {
  const sweepId = randomUUID();
  await pool.execute<ResultSetHeader>(
    `INSERT INTO sweep_runs (id, sweep_type, status) VALUES (?, 'birthday', 'running')`,
    [sweepId]
  );
  try {
    // Today's MM-DD in the server's timezone. The container is configured to
    // Europe/Amsterdam for the merchant base; we accept that as the boundary.
    const today = new Date();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");

    const [candidates] = await pool.execute<CandidateRow[]>(
      `SELECT c.id AS card_id, c.merchant_id, c.customer_id,
              m.business_name,
              cu.name AS customer_name,
              p.reward_text, p.config_json AS program_config
         FROM loyalty_cards c
         JOIN merchants m ON m.id = c.merchant_id
         JOIN customers cu ON cu.id = c.customer_id
         JOIN loyalty_programs p ON p.id = c.program_id
        WHERE c.status = 'active'
          AND cu.birthday IS NOT NULL
          AND DATE_FORMAT(cu.birthday, '%m-%d') = ?
          AND NOT EXISTS (
            SELECT 1 FROM message_deliveries md
             WHERE md.card_id = c.id
               AND md.source_type = 'birthday'
               AND md.status = 'sent'
               AND DATE(md.created_at) = CURDATE()
          )`,
      [`${mm}-${dd}`]
    );

    await pool.execute("UPDATE sweep_runs SET scanned = ? WHERE id = ?", [
      candidates.length,
      sweepId,
    ]);

    const counters = await dispatch("birthday", sweepId, candidates, (row) => ({
      header: `Happy birthday from ${row.business_name} 🎉`,
      body: "Drop in this week and we'll add 2 bonus stamps to your card.",
    }));

    await pool.execute(
      `UPDATE sweep_runs
          SET sent = ?, failed = ?, status = 'completed', finished_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [counters.sent, counters.failed, sweepId]
    );
    logger.info(
      { sweepId, ...counters, scanned: candidates.length, type: "birthday" },
      "sweep complete"
    );
    return { id: sweepId, scanned: candidates.length, ...counters };
  } catch (err) {
    logger.error({ err, sweepId }, "birthday sweep failed");
    await pool.execute(
      `UPDATE sweep_runs SET status = 'failed', error_message = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [(err as Error).message.slice(0, 500), sweepId]
    );
    throw err;
  }
}

export async function runInactivitySweep(): Promise<SweepResult> {
  const sweepId = randomUUID();
  await pool.execute<ResultSetHeader>(
    `INSERT INTO sweep_runs (id, sweep_type, status) VALUES (?, 'inactivity', 'running')`,
    [sweepId]
  );
  try {
    const [candidates] = await pool.execute<CandidateRow[]>(
      `SELECT c.id AS card_id, c.merchant_id, c.customer_id,
              m.business_name,
              cu.name AS customer_name,
              p.reward_text, p.config_json AS program_config
         FROM loyalty_cards c
         JOIN merchants m ON m.id = c.merchant_id
         JOIN customers cu ON cu.id = c.customer_id
         JOIN loyalty_programs p ON p.id = c.program_id
        WHERE c.status = 'active'
          AND c.last_event_at IS NOT NULL
          AND c.last_event_at < DATE_SUB(NOW(), INTERVAL ? DAY)
          AND NOT EXISTS (
            SELECT 1 FROM message_deliveries md
             WHERE md.card_id = c.id
               AND md.source_type = 'inactivity'
               AND md.status = 'sent'
               AND md.created_at > DATE_SUB(NOW(), INTERVAL ? DAY)
          )`,
      [INACTIVITY_DAYS, INACTIVITY_DAYS]
    );

    await pool.execute("UPDATE sweep_runs SET scanned = ? WHERE id = ?", [
      candidates.length,
      sweepId,
    ]);

    const counters = await dispatch("inactivity", sweepId, candidates, (row) => ({
      header: `We miss you at ${row.business_name}`,
      body: "Your loyalty card still has stamps waiting. See you soon?",
    }));

    await pool.execute(
      `UPDATE sweep_runs
          SET sent = ?, failed = ?, status = 'completed', finished_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [counters.sent, counters.failed, sweepId]
    );
    logger.info(
      { sweepId, ...counters, scanned: candidates.length, type: "inactivity" },
      "sweep complete"
    );
    return { id: sweepId, scanned: candidates.length, ...counters };
  } catch (err) {
    logger.error({ err, sweepId }, "inactivity sweep failed");
    await pool.execute(
      `UPDATE sweep_runs SET status = 'failed', error_message = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [(err as Error).message.slice(0, 500), sweepId]
    );
    throw err;
  }
}

// ---------- Retry ----------

/**
 * Re-attempt the failed deliveries of a given source. Used by the "Retry
 * failed" button in the Messages UI. Increments attempts; if a delivery has
 * already reached MAX_ATTEMPTS, it stays in failed state and is skipped.
 */
export async function retrySource(
  sourceType: SourceType,
  sourceId: string,
  merchantId: string,
  copyOverride?: { header: string; body: string }
): Promise<{ retried: number; sent: number; failed: number }> {
  const [rows] = await pool.execute<DeliveryRow[]>(
    `SELECT md.id, md.card_id, md.merchant_id, md.customer_id, md.attempts, md.status,
            m.business_name,
            cu.name AS customer_name,
            p.reward_text, p.config_json AS program_config
       FROM message_deliveries md
       JOIN loyalty_cards c ON c.id = md.card_id
       JOIN merchants m ON m.id = md.merchant_id
       JOIN customers cu ON cu.id = md.customer_id
       JOIN loyalty_programs p ON p.id = c.program_id
      WHERE md.source_type = ?
        AND md.source_id = ?
        AND md.merchant_id = ?
        AND md.status = 'failed'
        AND md.attempts < ?`,
    [sourceType, sourceId, merchantId, MAX_ATTEMPTS]
  );

  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    let header: string;
    let body: string;
    if (copyOverride) {
      header = copyOverride.header;
      body = copyOverride.body;
    } else if (sourceType === "birthday") {
      header = `Happy birthday from ${row.business_name} 🎉`;
      body = "Drop in this week and we'll add 2 bonus stamps to your card.";
    } else if (sourceType === "inactivity") {
      header = `We miss you at ${row.business_name}`;
      body = "Your loyalty card still has stamps waiting. See you soon?";
    } else {
      // Broadcast retry needs the original header/body. Caller must supply.
      throw new Error("broadcast retry requires the original header/body");
    }
    const result = await sendCustomCardMessage({ cardId: row.card_id, header, body });
    if (result.ok) {
      sent += 1;
      await pool.execute(
        `UPDATE message_deliveries
            SET status = 'sent', attempts = attempts + 1,
                last_attempt_at = CURRENT_TIMESTAMP, last_error = NULL
          WHERE id = ?`,
        [row.id]
      );
    } else {
      failed += 1;
      await pool.execute(
        `UPDATE message_deliveries
            SET status = 'failed', attempts = attempts + 1,
                last_attempt_at = CURRENT_TIMESTAMP, last_error = ?
          WHERE id = ?`,
        [(result.error ?? "unknown error").slice(0, 500), row.id]
      );
    }
  }

  // Roll the new totals up into the broadcast / sweep row.
  if (sourceType === "broadcast") {
    const [sums] = await pool.execute<RowDataPacket[]>(
      `SELECT
         SUM(status = 'sent')   AS sent,
         SUM(status = 'failed') AS failed
         FROM message_deliveries
        WHERE source_type = 'broadcast' AND source_id = ?`,
      [sourceId]
    );
    const row = sums[0];
    await pool.execute(
      "UPDATE broadcasts SET sent = ?, failed = ? WHERE id = ?",
      [Number(row.sent ?? 0), Number(row.failed ?? 0), sourceId]
    );
  } else {
    const [sums] = await pool.execute<RowDataPacket[]>(
      `SELECT
         SUM(status = 'sent')   AS sent,
         SUM(status = 'failed') AS failed
         FROM message_deliveries
        WHERE source_type = ? AND source_id = ?`,
      [sourceType, sourceId]
    );
    const row = sums[0];
    await pool.execute(
      "UPDATE sweep_runs SET sent = ?, failed = ? WHERE id = ?",
      [Number(row.sent ?? 0), Number(row.failed ?? 0), sourceId]
    );
  }

  return { retried: rows.length, sent, failed };
}
