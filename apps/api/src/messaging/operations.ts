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
import { sendCustomCardMessage, setLoyaltyObjectState } from "../wallet/loyalty.js";

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
export interface AudienceFilter {
  minLifetimeStamps?: number;
  withBirthdayThisMonth?: boolean;
  programId?: string;
}

export async function startBroadcast(
  merchantId: string,
  header: string,
  body: string,
  audienceFilter?: AudienceFilter
): Promise<string> {
  const id = randomUUID();
  await pool.execute<ResultSetHeader>(
    `INSERT INTO broadcasts (id, merchant_id, header, body, audience_filter, status)
     VALUES (?, ?, ?, ?, ?, 'running')`,
    [
      id,
      merchantId,
      header,
      body,
      audienceFilter ? JSON.stringify(audienceFilter) : null,
    ]
  );

  // Fire-and-forget background processing. Errors are caught + logged so the
  // process never unhandled-rejects.
  void runBroadcast(id, merchantId, header, body, audienceFilter).catch((err: unknown) => {
    logger.error({ err, broadcastId: id }, "broadcast crashed");
  });

  return id;
}

async function runBroadcast(
  id: string,
  merchantId: string,
  header: string,
  body: string,
  audienceFilter?: AudienceFilter
): Promise<void> {
  try {
    // Build a parametrised candidate query that grows with whatever filters
    // are set. Always tenant-scoped + active-only at the floor.
    const where: string[] = ["c.merchant_id = ?", "c.status = 'active'"];
    const params: (string | number)[] = [merchantId];
    if (audienceFilter?.minLifetimeStamps !== undefined) {
      where.push(
        "JSON_EXTRACT(c.card_state, '$.total_lifetime') >= ?"
      );
      params.push(audienceFilter.minLifetimeStamps);
    }
    if (audienceFilter?.withBirthdayThisMonth) {
      where.push("MONTH(cu.birthday) = MONTH(CURDATE())");
    }
    if (audienceFilter?.programId) {
      where.push("c.program_id = ?");
      params.push(audienceFilter.programId);
    }
    const [candidates] = await pool.execute<CandidateRow[]>(
      `SELECT c.id AS card_id, c.merchant_id, c.customer_id,
              m.business_name,
              cu.name AS customer_name,
              p.reward_text, p.config_json AS program_config
         FROM loyalty_cards c
         JOIN merchants m ON m.id = c.merchant_id
         JOIN customers cu ON cu.id = c.customer_id
         JOIN loyalty_programs p ON p.id = c.program_id
        WHERE ${where.join(" AND ")}`,
      params
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
          AND m.is_premium = TRUE
          AND m.crons_enabled = TRUE
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
          AND m.is_premium = TRUE
          AND m.crons_enabled = TRUE
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

// ---------- Card expiry sweep ----------
// Daily cron — finds active cards whose program has an expiry_days config and
// whose last_event_at is older than that. Flips status to 'expired' + writes
// an 'expire' card event + PATCHes the Google Wallet object to state=EXPIRED
// (Google moves the pass to "Inactive passes" automatically). All best-effort
// per-card — a single bad card doesn't stop the rest.

interface ExpiryCandidateRow extends RowDataPacket {
  card_id: string;
  merchant_id: string;
  program_config: unknown;
  last_event_at: Date | null;
  created_at: Date;
}

export async function runExpirySweep(): Promise<{ scanned: number; expired: number }> {
  // Pull all active cards on programs that have an expiry_days set. We compute
  // the per-card threshold in JS because expiry_days varies by program — too
  // ugly to inline into a single SQL WHERE.
  const [rows] = await pool.execute<ExpiryCandidateRow[]>(
    `SELECT c.id AS card_id, c.merchant_id, c.last_event_at, c.created_at,
            p.config_json AS program_config
       FROM loyalty_cards c
       JOIN loyalty_programs p ON p.id = c.program_id
      WHERE c.status = 'active'
        AND JSON_EXTRACT(p.config_json, '$.expiry_days') IS NOT NULL`
  );

  const now = Date.now();
  let expired = 0;
  for (const row of rows) {
    const cfg = parseJson<{ expiry_days?: number }>(row.program_config);
    const days = cfg.expiry_days ?? 0;
    if (days <= 0) continue;
    const cutoffMs = days * 24 * 60 * 60 * 1000;
    const lastActivity = row.last_event_at ?? row.created_at;
    if (now - new Date(lastActivity).getTime() < cutoffMs) continue;

    try {
      await pool.execute(
        "UPDATE loyalty_cards SET status = 'expired' WHERE id = ? AND status = 'active'",
        [row.card_id]
      );
      await pool.execute(
        `INSERT INTO card_events (merchant_id, card_id, event_type, delta_json, note)
         VALUES (?, ?, 'expire', ?, NULL)`,
        [row.merchant_id, row.card_id, JSON.stringify({ via: "expiry_sweep", days })]
      );
      // Best-effort wallet PATCH — failures are logged inside the helper.
      await setLoyaltyObjectState(row.card_id, "EXPIRED");
      expired += 1;
    } catch (err) {
      logger.error({ err, cardId: row.card_id }, "expiry sweep failed for card");
    }
  }

  logger.info({ scanned: rows.length, expired }, "expiry sweep complete");
  return { scanned: rows.length, expired };
}

// ---------- Points-batch expiry sweep (Day 14) ----------
// Daily cron — finds points_batches whose expires_at has passed (with
// remaining points still on them), zeroes their remainders, recomputes the
// owning card's balance, persists, PATCHes the wallet, and pushes a
// customer-visible "X points expired" notification.

interface ExpiredBatchRow extends RowDataPacket {
  id: string;
  card_id: string;
  merchant_id: string;
  points_remaining: number;
}

interface PointsCardInfoRow extends RowDataPacket {
  card_id: string;
  merchant_id: string;
  card_state: unknown;
  business_name: string;
}

export async function runPointsExpirySweep(): Promise<{
  scanned: number;
  expired: number;
}> {
  // One pass: gather all batches whose expiry has just passed but that still
  // have value on them. We process each in its own try/catch so a single bad
  // card doesn't stop the rest.
  const [rows] = await pool.execute<ExpiredBatchRow[]>(
    `SELECT id, card_id, merchant_id, points_remaining
       FROM points_batches
      WHERE points_remaining > 0
        AND expires_at IS NOT NULL
        AND expires_at <= NOW()
      ORDER BY card_id ASC`
  );

  if (rows.length === 0) {
    logger.info({ scanned: 0, expired: 0 }, "points-expiry sweep complete (nothing to do)");
    return { scanned: 0, expired: 0 };
  }

  // Group expired batches by card so we update card_state + notify once per
  // card rather than once per batch.
  const byCard = new Map<string, { merchantId: string; pointsLost: number; batchIds: string[] }>();
  for (const row of rows) {
    const entry = byCard.get(row.card_id) ?? {
      merchantId: row.merchant_id,
      pointsLost: 0,
      batchIds: [],
    };
    entry.pointsLost += Number(row.points_remaining);
    entry.batchIds.push(row.id);
    byCard.set(row.card_id, entry);
  }

  let totalExpired = 0;
  for (const [cardId, info] of byCard) {
    try {
      // Zero out the batch remainders.
      await pool.execute(
        `UPDATE points_batches SET points_remaining = 0 WHERE id IN (${info.batchIds
          .map(() => "?")
          .join(",")})`,
        info.batchIds
      );

      // Recompute the card's balance from the surviving (non-expired,
      // non-empty) batches, then update card_state.
      const [balRows] = await pool.execute<RowDataPacket[]>(
        `SELECT COALESCE(SUM(points_remaining), 0) AS bal
           FROM points_batches
          WHERE card_id = ?
            AND points_remaining > 0
            AND (expires_at IS NULL OR expires_at > NOW())`,
        [cardId]
      );
      const newBalance = Number(balRows[0]?.bal ?? 0);

      const [cardRows] = await pool.execute<PointsCardInfoRow[]>(
        `SELECT c.id AS card_id, c.merchant_id, c.card_state,
                m.business_name
           FROM loyalty_cards c
           JOIN merchants m ON m.id = c.merchant_id
          WHERE c.id = ? LIMIT 1`,
        [cardId]
      );
      if (cardRows.length === 0) continue;
      const cardRow = cardRows[0];
      const state = parseJson<{
        type: "points";
        points_current: number;
        total_lifetime: number;
        rewards_redeemed: number;
        total_expired: number;
      }>(cardRow.card_state);
      if (state.type !== "points") continue;

      const newState = {
        type: "points" as const,
        points_current: newBalance,
        total_lifetime: state.total_lifetime,
        rewards_redeemed: state.rewards_redeemed,
        total_expired: state.total_expired + info.pointsLost,
      };

      await pool.execute(
        "UPDATE loyalty_cards SET card_state = ? WHERE id = ?",
        [JSON.stringify(newState), cardId]
      );
      await pool.execute(
        `INSERT INTO card_events (merchant_id, card_id, event_type, delta_json, note)
         VALUES (?, ?, 'expire', ?, NULL)`,
        [
          info.merchantId,
          cardId,
          JSON.stringify({
            via: "points_expiry_sweep",
            points_expired: info.pointsLost,
            balance_before: state.points_current,
            balance_after: newState.points_current,
            batches: info.batchIds.length,
          }),
        ]
      );

      // Wallet refresh + customer-visible notification. Best-effort, errors
      // logged inside the helper.
      const { syncCardToWallet } = await import("../cards/operations.js");
      await syncCardToWallet(cardId, info.merchantId, "stamp");
      const { sendCustomCardMessage } = await import("../wallet/loyalty.js");
      await sendCustomCardMessage({
        cardId,
        header: `${info.pointsLost} points expired at ${cardRow.business_name}`,
        body: `You now have ${newBalance} points. Visit again to start earning fresh!`,
      });

      totalExpired += 1;
    } catch (err) {
      logger.error(
        { err, cardId, pointsLost: info.pointsLost },
        "points-expiry sweep failed for card"
      );
    }
  }

  logger.info(
    { scanned: rows.length, expired: totalExpired },
    "points-expiry sweep complete"
  );
  return { scanned: rows.length, expired: totalExpired };
}
