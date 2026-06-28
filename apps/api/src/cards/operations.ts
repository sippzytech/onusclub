// Shared stamp / redeem core. The existing /v1/cards/:id/stamp + /:id/redeem
// routes call these, and so does /v1/scan — keeping one transactional path
// for "increase the count" means there's a single place that runs SELECT FOR
// UPDATE, mirrors to Google Wallet, and pushes the notification.

import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import type {
  CardDetail,
  CardEvent,
  PointsCardState,
  StampCardState,
} from "@onusclub/shared";
import { pool } from "../db/pool.js";
import { env } from "../config.js";
import { ApiError } from "../errors.js";
import { logger } from "../logger.js";
import { sendCardMessage } from "../wallet/loyalty.js";
import {
  createLoyaltyObject,
  ensureLoyaltyClass,
  patchLoyaltyObject,
} from "../wallet/loyalty.js";
import type { WalletEvent } from "../wallet/state.js";
import { sendApnsPushBatch } from "../wallet-apple/apns.js";

interface CardRow extends RowDataPacket {
  id: string;
  merchant_id: string;
  customer_id: string;
  program_id: string;
  card_state: unknown;
  qr_token: string;
  status: "active" | "blocked";
  created_at: Date;
  last_event_at: Date | null;
  customer_name: string | null;
  program_name: string;
  program_type: "stamp" | "points";
  program_config: unknown;
  reward_text: string;
}

interface EventRow extends RowDataPacket {
  id: number;
  card_id: string;
  event_type: CardEvent["eventType"];
  delta_json: unknown;
  note: string | null;
  created_at: Date;
}

interface SyncRow extends RowDataPacket {
  merchant_id: string;
  business_name: string;
  brand_color: string | null;
  logo_url: string | null;
  google_wallet_class_id: string | null;
  program_id: string;
  program_name: string;
  program_type: "stamp" | "points";
  program_config: unknown;
  reward_text: string;
  qr_token: string;
  card_state: unknown;
  google_wallet_object_id: string | null;
  customer_name: string | null;
}

function parseJson<T>(value: unknown): T {
  return typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
}

const CARD_SELECT = `
  SELECT c.id, c.merchant_id, c.customer_id, c.program_id, c.card_state,
         c.qr_token, c.status, c.created_at, c.last_event_at,
         cu.name AS customer_name,
         p.name AS program_name,
         p.program_type,
         p.config_json AS program_config,
         p.reward_text
    FROM loyalty_cards c
    JOIN customers cu ON cu.id = c.customer_id
    JOIN loyalty_programs p ON p.id = c.program_id
`;

/**
 * Pull the type-specific config fields a Card needs to expose. For stamp
 * programs only stampsRequired is populated; for points programs only the
 * points-side fields. Unsupported program types fall through to all zeros /
 * nulls so the API response shape is always stable.
 */
function programFields(
  programType: "stamp" | "points",
  configJson: unknown
): { stampsRequired: number; pointsForReward: number | null; pointsPerEuro: number | null } {
  if (programType === "points") {
    const cfg = parseJson<{ points_for_reward?: number; points_per_euro?: number }>(configJson);
    return {
      stampsRequired: 0,
      pointsForReward: cfg.points_for_reward ?? null,
      pointsPerEuro: cfg.points_per_euro ?? null,
    };
  }
  const cfg = parseJson<{ stamps_required?: number }>(configJson);
  return {
    stampsRequired: cfg.stamps_required ?? 0,
    pointsForReward: null,
    pointsPerEuro: null,
  };
}

function rowToCardDetail(row: CardRow, events: EventRow[]): CardDetail {
  return {
    card: {
      id: row.id,
      merchantId: row.merchant_id,
      customerId: row.customer_id,
      programId: row.program_id,
      customerName: row.customer_name,
      programName: row.program_name,
      programType: row.program_type,
      ...programFields(row.program_type, row.program_config),
      cardState: parseJson(row.card_state),
      qrToken: row.qr_token,
      status: row.status,
      rewardText: row.reward_text,
      createdAt: new Date(row.created_at).toISOString(),
      lastEventAt: row.last_event_at ? new Date(row.last_event_at).toISOString() : null,
    },
    events: events.map((e) => ({
      id: e.id,
      cardId: e.card_id,
      eventType: e.event_type,
      deltaJson: parseJson(e.delta_json),
      note: e.note,
      createdAt: new Date(e.created_at).toISOString(),
    })),
  };
}

async function loadCardForUpdate(
  conn: PoolConnection,
  cardId: string,
  merchantId: string
): Promise<{ row: CardRow; state: StampCardState; stampsRequired: number }> {
  const [rows] = await conn.execute<CardRow[]>(
    `${CARD_SELECT} WHERE c.id = ? AND c.merchant_id = ? FOR UPDATE`,
    [cardId, merchantId]
  );
  if (rows.length === 0) throw ApiError.notFound("card not found");
  const row = rows[0];
  if (row.status !== "active") throw ApiError.badRequest("card is not active");
  const state = parseJson<StampCardState>(row.card_state);
  if (state.type !== "stamp") throw ApiError.badRequest("not a stamp card");
  const cfg = parseJson<{ stamps_required?: number }>(row.program_config);
  const stampsRequired = cfg.stamps_required ?? 0;
  if (stampsRequired <= 0) throw ApiError.badRequest("program misconfigured");
  return { row, state, stampsRequired };
}

async function loadCardEvents(
  conn: PoolConnection,
  cardId: string,
  merchantId: string
): Promise<EventRow[]> {
  const [rows] = await conn.execute<EventRow[]>(
    `SELECT id, card_id, event_type, delta_json, note, created_at
       FROM card_events WHERE card_id = ? AND merchant_id = ?
       ORDER BY id DESC LIMIT 50`,
    [cardId, merchantId]
  );
  return rows;
}

async function loadCardOutsideTransaction(
  cardId: string,
  merchantId: string
): Promise<{ detail: CardDetail }> {
  const [cardRows] = await pool.execute<CardRow[]>(
    `${CARD_SELECT} WHERE c.id = ? AND c.merchant_id = ?`,
    [cardId, merchantId]
  );
  if (cardRows.length === 0) throw ApiError.notFound("card not found");
  const [eventRows] = await pool.execute<EventRow[]>(
    `SELECT id, card_id, event_type, delta_json, note, created_at
       FROM card_events WHERE card_id = ? AND merchant_id = ?
       ORDER BY id DESC LIMIT 50`,
    [cardId, merchantId]
  );
  return { detail: rowToCardDetail(cardRows[0], eventRows) };
}

/**
 * Mirror the card to Google Wallet + push the event notification. Runs after
 * the DB transaction commits. Wallet failures are logged, not thrown.
 */
export async function syncCardToWallet(
  cardId: string,
  merchantId: string,
  event: WalletEvent
): Promise<void> {
  try {
    const [rows] = await pool.execute<SyncRow[]>(
      `SELECT m.id AS merchant_id, m.business_name, m.brand_color, m.logo_url,
              m.google_wallet_class_id,
              p.id AS program_id, p.name AS program_name, p.program_type,
              p.config_json AS program_config, p.reward_text,
              c.qr_token, c.card_state, c.google_wallet_object_id,
              cu.name AS customer_name
         FROM loyalty_cards c
         JOIN merchants m ON m.id = c.merchant_id
         JOIN loyalty_programs p ON p.id = c.program_id
         JOIN customers cu ON cu.id = c.customer_id
        WHERE c.id = ? AND c.merchant_id = ?
        LIMIT 1`,
      [cardId, merchantId]
    );
    if (rows.length === 0) return;
    const row = rows[0];

    const merchantBranding = {
      id: row.merchant_id,
      businessName: row.business_name,
      brandColor: row.brand_color,
      logoUrl: row.logo_url,
    };

    // Branch by program type so we hand the wallet builders the discriminated
    // shapes they expect. Both branches share the same downstream class/object
    // create/patch flow.
    let programForWallet;
    let cardForWallet;
    let currentValue: number;
    let thresholdValue: number;
    let unitLabel: "stamps" | "points";

    if (row.program_type === "points") {
      const state = parseJson<PointsCardState>(row.card_state);
      if (state.type !== "points") return;
      const cfg = parseJson<{ points_for_reward?: number }>(row.program_config);
      const pointsForReward = cfg.points_for_reward ?? 0;
      if (pointsForReward <= 0) return;
      programForWallet = {
        programType: "points" as const,
        id: row.program_id,
        name: row.program_name,
        rewardText: row.reward_text,
        pointsForReward,
      };
      cardForWallet = {
        id: cardId,
        qrToken: row.qr_token,
        state,
        customerName: row.customer_name,
      };
      currentValue = state.points_current;
      thresholdValue = pointsForReward;
      unitLabel = "points";
    } else {
      const state = parseJson<StampCardState>(row.card_state);
      if (state.type !== "stamp") return;
      const cfg = parseJson<{ stamps_required?: number }>(row.program_config);
      const stampsRequired = cfg.stamps_required ?? 0;
      if (stampsRequired <= 0) return;
      programForWallet = {
        programType: "stamp" as const,
        id: row.program_id,
        name: row.program_name,
        rewardText: row.reward_text,
        stampsRequired,
      };
      cardForWallet = {
        id: cardId,
        qrToken: row.qr_token,
        state,
        customerName: row.customer_name,
      };
      currentValue = state.stamps_current;
      thresholdValue = stampsRequired;
      unitLabel = "stamps";
    }

    await ensureLoyaltyClass(merchantBranding, programForWallet, row.google_wallet_class_id);
    if (!row.google_wallet_object_id) {
      await createLoyaltyObject(merchantBranding, programForWallet, cardForWallet);
    } else {
      await patchLoyaltyObject(programForWallet, cardForWallet);
    }
    // Best-effort fan-out: nudge Apple Wallet on every registered device so
    // the pass updates in place. Independent of Google Wallet — separate
    // ecosystem, separate failure mode.
    void pushAppleWalletUpdate(cardId).catch((err) => {
      logger.error({ err, cardId }, "apple wallet push failed");
    });

    await sendCardMessage({
      event,
      businessName: row.business_name,
      rewardText: row.reward_text,
      currentValue,
      thresholdValue,
      unitLabel,
      cardId,
    });
  } catch (err) {
    logger.error({ err, cardId, event }, "wallet sync failed");
  }
}

interface ApnsRegRow extends RowDataPacket {
  id: string;
  push_token: string;
}

/**
 * Fan out a wallet-update push to every registered Apple Wallet device for
 * this card. Wallet on the device wakes up, calls our get-latest-pass
 * endpoint, and the pass refreshes in place.
 *
 * Cleans up stale registrations whose tokens APNs reports as 410 (the user
 * deleted the pass — no point keeping the row).
 */
export async function pushAppleWalletUpdate(cardId: string): Promise<void> {
  if (!env.APPLE_PASS_TYPE_ID) return;
  const [rows] = await pool.execute<ApnsRegRow[]>(
    "SELECT id, push_token FROM apple_pass_registrations WHERE card_id = ?",
    [cardId]
  );
  if (rows.length === 0) return;

  const results = await sendApnsPushBatch(
    rows.map((r) => r.push_token),
    env.APPLE_PASS_TYPE_ID
  );

  let delivered = 0;
  const staleIds: string[] = [];
  results.forEach((r, idx) => {
    if (r.ok) {
      delivered++;
    } else if (r.status === 410) {
      staleIds.push(rows[idx].id);
    } else {
      logger.warn(
        { cardId, status: r.status, reason: r.reason },
        "apple wallet push failed for one device"
      );
    }
  });
  if (staleIds.length > 0) {
    await pool.execute(
      `DELETE FROM apple_pass_registrations WHERE id IN (${staleIds.map(() => "?").join(",")})`,
      staleIds
    );
  }
  logger.info(
    { cardId, total: rows.length, delivered, removedStale: staleIds.length },
    "apple wallet push fan-out"
  );
}

export async function stampCardById(
  cardId: string,
  merchantId: string
): Promise<CardDetail> {
  const conn = await pool.getConnection();
  let event: WalletEvent = "stamp";
  try {
    await conn.beginTransaction();
    const { state, stampsRequired } = await loadCardForUpdate(conn, cardId, merchantId);

    if (state.stamps_current >= stampsRequired) {
      throw ApiError.badRequest(
        "card is at the reward threshold — redeem first before stamping again"
      );
    }

    const before = state.stamps_current;
    const newState: StampCardState = {
      type: "stamp",
      stamps_current: state.stamps_current + 1,
      total_lifetime: state.total_lifetime + 1,
      rewards_redeemed: state.rewards_redeemed,
    };

    await conn.execute<ResultSetHeader>(
      `UPDATE loyalty_cards
          SET card_state = ?, last_event_at = CURRENT_TIMESTAMP
        WHERE id = ? AND merchant_id = ?`,
      [JSON.stringify(newState), cardId, merchantId]
    );
    await conn.execute<ResultSetHeader>(
      `INSERT INTO card_events (merchant_id, card_id, event_type, delta_json, note)
       VALUES (?, ?, 'stamp', ?, NULL)`,
      [
        merchantId,
        cardId,
        JSON.stringify({
          stamps_before: before,
          stamps_after: newState.stamps_current,
          stamps_required: stampsRequired,
        }),
      ]
    );

    if (newState.stamps_current >= stampsRequired) event = "threshold";

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  await syncCardToWallet(cardId, merchantId, event);
  const { detail } = await loadCardOutsideTransaction(cardId, merchantId);
  return detail;
}

/**
 * Public redeem entry. Auto-dispatches by program type so the existing
 * /v1/cards/:id/redeem route and /v1/scan flow work for both stamps and
 * points without the caller needing to know which kind of card it is.
 */
export async function redeemCardById(
  cardId: string,
  merchantId: string
): Promise<CardDetail> {
  // Quick read (outside the transaction) just to discover the type. The
  // body below re-locks under FOR UPDATE.
  const [typeRows] = await pool.execute<RowDataPacket[]>(
    `SELECT p.program_type FROM loyalty_cards c
       JOIN loyalty_programs p ON p.id = c.program_id
      WHERE c.id = ? AND c.merchant_id = ? LIMIT 1`,
    [cardId, merchantId]
  );
  if (typeRows.length === 0) throw ApiError.notFound("card not found");
  if (typeRows[0].program_type === "points") {
    return redeemPointsCard(cardId, merchantId);
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { state, stampsRequired } = await loadCardForUpdate(conn, cardId, merchantId);

    if (state.stamps_current < stampsRequired) {
      throw ApiError.badRequest(
        `not enough stamps to redeem (${state.stamps_current}/${stampsRequired})`
      );
    }

    const rewardsBefore = state.rewards_redeemed;
    const newState: StampCardState = {
      type: "stamp",
      stamps_current: 0,
      total_lifetime: state.total_lifetime,
      rewards_redeemed: rewardsBefore + 1,
    };

    await conn.execute<ResultSetHeader>(
      `UPDATE loyalty_cards
          SET card_state = ?, last_event_at = CURRENT_TIMESTAMP
        WHERE id = ? AND merchant_id = ?`,
      [JSON.stringify(newState), cardId, merchantId]
    );
    await conn.execute<ResultSetHeader>(
      `INSERT INTO card_events (merchant_id, card_id, event_type, delta_json, note)
       VALUES (?, ?, 'redeem', ?, NULL)`,
      [
        merchantId,
        cardId,
        JSON.stringify({
          stamps_required: stampsRequired,
          rewards_redeemed_before: rewardsBefore,
          rewards_redeemed_after: newState.rewards_redeemed,
        }),
      ]
    );

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  await syncCardToWallet(cardId, merchantId, "redeem");
  const { detail } = await loadCardOutsideTransaction(cardId, merchantId);
  return detail;
}

// ============================================================================
// Points-program operations (Day 14).
//
// Points cards track every "+points" event as a row in `points_batches`, each
// with its own expires_at timer. Balance = SUM(batch.points_remaining) across
// rows where expires_at IS NULL OR expires_at > NOW(). Redemptions deduct
// the reward threshold from the oldest non-expired batch first (FIFO), so
// what's earned earliest is used earliest — fair and matches Starbucks.
// ============================================================================

interface PointsBatchRow extends RowDataPacket {
  id: string;
  points_remaining: number;
  expires_at: Date | null;
}

interface PointsProgramConfigShape {
  type: "points";
  points_per_euro: number;
  points_for_reward: number;
  batch_expiry_days?: number;
}

async function loadPointsCardForUpdate(
  conn: PoolConnection,
  cardId: string,
  merchantId: string
): Promise<{
  row: CardRow;
  state: PointsCardState;
  config: PointsProgramConfigShape;
}> {
  const [rows] = await conn.execute<CardRow[]>(
    `${CARD_SELECT} WHERE c.id = ? AND c.merchant_id = ? FOR UPDATE`,
    [cardId, merchantId]
  );
  if (rows.length === 0) throw ApiError.notFound("card not found");
  const row = rows[0];
  if (row.status !== "active") throw ApiError.badRequest("card is not active");
  if (row.program_type !== "points") {
    throw ApiError.badRequest("not a points card");
  }
  const state = parseJson<PointsCardState>(row.card_state);
  if (state.type !== "points") throw ApiError.badRequest("card state mismatch");
  const config = parseJson<PointsProgramConfigShape>(row.program_config);
  if (
    typeof config.points_per_euro !== "number" ||
    typeof config.points_for_reward !== "number"
  ) {
    throw ApiError.badRequest("program misconfigured");
  }
  return { row, state, config };
}

/**
 * Sum non-expired batch remainders for a card. Authoritative source for
 * `points_current`; we cache it back into card_state on every write so reads
 * don't always have to re-aggregate.
 */
async function computePointsBalance(
  conn: PoolConnection,
  cardId: string
): Promise<number> {
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT COALESCE(SUM(points_remaining), 0) AS bal
       FROM points_batches
      WHERE card_id = ?
        AND points_remaining > 0
        AND (expires_at IS NULL OR expires_at > NOW())`,
    [cardId]
  );
  return Number(rows[0]?.bal ?? 0);
}

/**
 * Apply a transaction to a points card. Merchant enters the bill amount; we
 * compute points = floor(amount × points_per_euro), insert a fresh batch row
 * with the program's batch expiry (if any), recompute the card balance, and
 * write back card_state. Mirrors stampCardById's transactional pattern.
 */
export async function addPointsToCard(
  cardId: string,
  merchantId: string,
  amountEuros: number
): Promise<CardDetail> {
  if (amountEuros <= 0) throw ApiError.badRequest("amount must be positive");

  const conn = await pool.getConnection();
  let event: WalletEvent = "stamp"; // re-use existing event types; semantics flexed
  try {
    await conn.beginTransaction();
    const { state, config } = await loadPointsCardForUpdate(conn, cardId, merchantId);

    const pointsEarned = Math.floor(amountEuros * config.points_per_euro);
    if (pointsEarned <= 0) {
      throw ApiError.badRequest(
        "transaction would award 0 points (amount × points_per_euro rounds to 0)"
      );
    }

    const expiresAt =
      config.batch_expiry_days && config.batch_expiry_days > 0
        ? new Date(Date.now() + config.batch_expiry_days * 24 * 60 * 60 * 1000)
        : null;

    await conn.execute<ResultSetHeader>(
      `INSERT INTO points_batches
         (id, card_id, merchant_id, points_earned, points_remaining, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [randomUUID(), cardId, merchantId, pointsEarned, pointsEarned, expiresAt]
    );

    const newBalance = await computePointsBalance(conn, cardId);
    const newState: PointsCardState = {
      type: "points",
      points_current: newBalance,
      total_lifetime: state.total_lifetime + pointsEarned,
      rewards_redeemed: state.rewards_redeemed,
      total_expired: state.total_expired,
    };

    await conn.execute<ResultSetHeader>(
      `UPDATE loyalty_cards
          SET card_state = ?, last_event_at = CURRENT_TIMESTAMP
        WHERE id = ? AND merchant_id = ?`,
      [JSON.stringify(newState), cardId, merchantId]
    );
    await conn.execute<ResultSetHeader>(
      `INSERT INTO card_events (merchant_id, card_id, event_type, delta_json, note)
       VALUES (?, ?, 'points_add', ?, NULL)`,
      [
        merchantId,
        cardId,
        JSON.stringify({
          amount_euros: amountEuros,
          points_earned: pointsEarned,
          points_per_euro: config.points_per_euro,
          balance_before: state.points_current,
          balance_after: newState.points_current,
          points_for_reward: config.points_for_reward,
          expires_at: expiresAt ? expiresAt.toISOString() : null,
        }),
      ]
    );

    if (
      state.points_current < config.points_for_reward &&
      newState.points_current >= config.points_for_reward
    ) {
      event = "threshold";
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  await syncCardToWallet(cardId, merchantId, event);
  const { detail } = await loadCardOutsideTransaction(cardId, merchantId);
  return detail;
}

/**
 * Redeem a points-program reward: deduct `points_for_reward` from the oldest
 * non-expired batches (FIFO). Throws 400 if balance is below threshold.
 */
export async function redeemPointsCard(
  cardId: string,
  merchantId: string
): Promise<CardDetail> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { state, config } = await loadPointsCardForUpdate(conn, cardId, merchantId);

    if (state.points_current < config.points_for_reward) {
      throw ApiError.badRequest(
        `not enough points to redeem (${state.points_current}/${config.points_for_reward})`
      );
    }

    // FIFO deduction. Lock the rows so a concurrent addPoints can't insert
    // between read and update. Reading inside a FOR UPDATE on the parent
    // card row already serializes here, but the explicit FOR UPDATE on the
    // batch rows guards if we ever relax that.
    const [batches] = await conn.execute<PointsBatchRow[]>(
      `SELECT id, points_remaining, expires_at
         FROM points_batches
        WHERE card_id = ?
          AND points_remaining > 0
          AND (expires_at IS NULL OR expires_at > NOW())
        ORDER BY earned_at ASC
        FOR UPDATE`,
      [cardId]
    );

    let toDeduct = config.points_for_reward;
    for (const batch of batches) {
      if (toDeduct <= 0) break;
      const fromThis = Math.min(batch.points_remaining, toDeduct);
      await conn.execute<ResultSetHeader>(
        "UPDATE points_batches SET points_remaining = points_remaining - ? WHERE id = ?",
        [fromThis, batch.id]
      );
      toDeduct -= fromThis;
    }
    if (toDeduct > 0) {
      // Should be unreachable — balance check above guarantees enough points
      // — but if a race somehow lets us through, abort cleanly rather than
      // half-deduct.
      throw ApiError.badRequest("insufficient batched points for redemption");
    }

    const newBalance = await computePointsBalance(conn, cardId);
    const newState: PointsCardState = {
      type: "points",
      points_current: newBalance,
      total_lifetime: state.total_lifetime,
      rewards_redeemed: state.rewards_redeemed + 1,
      total_expired: state.total_expired,
    };

    await conn.execute<ResultSetHeader>(
      `UPDATE loyalty_cards
          SET card_state = ?, last_event_at = CURRENT_TIMESTAMP
        WHERE id = ? AND merchant_id = ?`,
      [JSON.stringify(newState), cardId, merchantId]
    );
    await conn.execute<ResultSetHeader>(
      `INSERT INTO card_events (merchant_id, card_id, event_type, delta_json, note)
       VALUES (?, ?, 'redeem', ?, NULL)`,
      [
        merchantId,
        cardId,
        JSON.stringify({
          points_for_reward: config.points_for_reward,
          balance_before: state.points_current,
          balance_after: newState.points_current,
          rewards_redeemed_before: state.rewards_redeemed,
          rewards_redeemed_after: newState.rewards_redeemed,
        }),
      ]
    );

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  await syncCardToWallet(cardId, merchantId, "redeem");
  const { detail } = await loadCardOutsideTransaction(cardId, merchantId);
  return detail;
}

export async function getCardDetail(
  cardId: string,
  merchantId: string
): Promise<CardDetail> {
  const { detail } = await loadCardOutsideTransaction(cardId, merchantId);
  return detail;
}

export type ScanLookup =
  | {
      kind: "stamp";
      id: string;
      customerName: string | null;
      programName: string;
      rewardText: string;
      stampsCurrent: number;
      stampsRequired: number;
      stampedToday: boolean;
    }
  | {
      kind: "points";
      id: string;
      customerName: string | null;
      programName: string;
      rewardText: string;
      pointsCurrent: number;
      pointsForReward: number;
      pointsPerEuro: number;
    };

/**
 * Resolve a card by its qr_token, scoped to the merchant. Used by /v1/scan.
 * Returns a discriminated union so the scan route can branch by program type.
 *
 * For stamp cards: includes stampedToday so the route can enforce the
 * "one stamp per day" rule. Points cards have no equivalent rate-limit
 * (multiple transactions per customer per day are normal).
 */
export async function findCardByQrToken(
  qrToken: string,
  merchantId: string
): Promise<ScanLookup | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT c.id, c.card_state,
            cu.name AS customer_name,
            p.name AS program_name, p.program_type, p.reward_text,
            p.config_json AS program_config,
            EXISTS (
              SELECT 1 FROM card_events e
               WHERE e.card_id = c.id
                 AND e.event_type = 'stamp'
                 AND DATE(e.created_at) = CURDATE()
            ) AS stamped_today
       FROM loyalty_cards c
       JOIN customers cu ON cu.id = c.customer_id
       JOIN loyalty_programs p ON p.id = c.program_id
      WHERE c.qr_token = ? AND c.merchant_id = ? AND c.status = 'active'
      LIMIT 1`,
    [qrToken, merchantId]
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  const programType = row.program_type as "stamp" | "points";

  if (programType === "points") {
    const state = parseJson<PointsCardState>(row.card_state);
    const cfg = parseJson<{ points_for_reward?: number; points_per_euro?: number }>(
      row.program_config
    );
    return {
      kind: "points",
      id: row.id as string,
      customerName: (row.customer_name as string | null) ?? null,
      programName: row.program_name as string,
      rewardText: row.reward_text as string,
      pointsCurrent: state.points_current,
      pointsForReward: cfg.points_for_reward ?? 0,
      pointsPerEuro: cfg.points_per_euro ?? 1,
    };
  }
  const state = parseJson<StampCardState>(row.card_state);
  const cfg = parseJson<{ stamps_required?: number }>(row.program_config);
  return {
    kind: "stamp",
    id: row.id as string,
    customerName: (row.customer_name as string | null) ?? null,
    programName: row.program_name as string,
    rewardText: row.reward_text as string,
    stampsCurrent: state.stamps_current,
    stampsRequired: cfg.stamps_required ?? 0,
    stampedToday: Number(row.stamped_today) === 1,
  };
}
