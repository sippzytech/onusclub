// Shared stamp / redeem core. The existing /v1/cards/:id/stamp + /:id/redeem
// routes call these, and so does /v1/scan — keeping one transactional path
// for "increase the count" means there's a single place that runs SELECT FOR
// UPDATE, mirrors to Google Wallet, and pushes the notification.

import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import type { CardDetail, CardEvent, StampCardState } from "@onusclub/shared";
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
         p.config_json AS program_config,
         p.reward_text
    FROM loyalty_cards c
    JOIN customers cu ON cu.id = c.customer_id
    JOIN loyalty_programs p ON p.id = c.program_id
`;

function rowToCardDetail(row: CardRow, events: EventRow[]): CardDetail {
  const cfg = parseJson<{ stamps_required?: number }>(row.program_config);
  return {
    card: {
      id: row.id,
      merchantId: row.merchant_id,
      customerId: row.customer_id,
      programId: row.program_id,
      customerName: row.customer_name,
      programName: row.program_name,
      stampsRequired: cfg.stamps_required ?? 0,
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
              p.id AS program_id, p.name AS program_name,
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
    const state = parseJson<StampCardState>(row.card_state);
    if (state.type !== "stamp") return;
    const cfg = parseJson<{ stamps_required?: number }>(row.program_config);
    const stampsRequired = cfg.stamps_required ?? 0;
    if (stampsRequired <= 0) return;

    const merchantBranding = {
      id: row.merchant_id,
      businessName: row.business_name,
      brandColor: row.brand_color,
      logoUrl: row.logo_url,
    };
    const programForWallet = {
      id: row.program_id,
      name: row.program_name,
      rewardText: row.reward_text,
      stampsRequired,
    };
    const cardForWallet = {
      id: cardId,
      qrToken: row.qr_token,
      state,
      customerName: row.customer_name,
    };

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
      stampsCurrent: state.stamps_current,
      stampsRequired,
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

export async function redeemCardById(
  cardId: string,
  merchantId: string
): Promise<CardDetail> {
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

export async function getCardDetail(
  cardId: string,
  merchantId: string
): Promise<CardDetail> {
  const { detail } = await loadCardOutsideTransaction(cardId, merchantId);
  return detail;
}

/**
 * Resolve a card by its qr_token, scoped to the merchant. Used by /v1/scan.
 * Also returns whether the card already has a stamp event for today (server's
 * local date) so the scan route can enforce the "one stamp per day" rule.
 */
export async function findCardByQrToken(
  qrToken: string,
  merchantId: string
): Promise<
  | {
      id: string;
      stampsCurrent: number;
      stampsRequired: number;
      stampedToday: boolean;
    }
  | null
> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT c.id, c.card_state, p.config_json AS program_config,
            EXISTS (
              SELECT 1 FROM card_events e
               WHERE e.card_id = c.id
                 AND e.event_type = 'stamp'
                 AND DATE(e.created_at) = CURDATE()
            ) AS stamped_today
       FROM loyalty_cards c
       JOIN loyalty_programs p ON p.id = c.program_id
      WHERE c.qr_token = ? AND c.merchant_id = ? AND c.status = 'active'
      LIMIT 1`,
    [qrToken, merchantId]
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  const state = parseJson<StampCardState>(row.card_state);
  const cfg = parseJson<{ stamps_required?: number }>(row.program_config);
  return {
    id: row.id as string,
    stampsCurrent: state.stamps_current,
    stampsRequired: cfg.stamps_required ?? 0,
    stampedToday: Number(row.stamped_today) === 1,
  };
}
