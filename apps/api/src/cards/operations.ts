// Shared stamp / redeem core. The existing /v1/cards/:id/stamp + /:id/redeem
// routes call these, and so does /v1/scan — keeping one transactional path
// for "increase the count" means there's a single place that runs SELECT FOR
// UPDATE, mirrors to Google Wallet, and pushes the notification.

import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import {
  euroToCents,
  type CardDesign,
  type CardDetail,
  type CardEvent,
  type PointsCardState,
  type StampCardState,
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
import { objectOnCurrentIssuer } from "../wallet/state.js";
import type { WalletEvent } from "../wallet/state.js";
import { sendApnsPushBatch } from "../wallet-apple/apns.js";
import { writeAuditLog } from "../admin/audit.js";
import { loadMerchantLocations } from "../merchants/locations.js";
import type { AdminActor } from "../admin/authorize.js";

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
  amount_cents: number | string | null;
  note: string | null;
  created_at: Date;
}

// MySQL hands BIGINT back as a string once it exceeds the safe-integer range,
// and mysql2 does not narrow it for us. Amounts never get near that, but
// normalising here means callers never have to think about which type they
// got — and a NULL (no amount captured) stays NULL rather than becoming 0.
function toAmountCents(value: number | string | null): number | null {
  if (value === null) return null;
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? n : null;
}

// Every card_events read goes through this list so the amount column can
// never be forgotten on a new query.
const EVENT_SELECT_COLUMNS =
  "id, card_id, event_type, delta_json, amount_cents, note, created_at";

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
      amountCents: toAmountCents(e.amount_cents),
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
    `SELECT ${EVENT_SELECT_COLUMNS}
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
    `SELECT ${EVENT_SELECT_COLUMNS}
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
  event: WalletEvent,
  // Whether to also push a notification to the customer's pass.
  //
  // Default true — every ordinary stamp, redeem and points transaction tells
  // the customer what just happened, which is most of the value of a wallet
  // pass. Set false for changes the customer did not initiate: a manual
  // adjustment made from the platform-admin dashboard must correct the pass
  // without pushing "You earned a stamp!" for something they never did, or
  // alarming them about a reduction they have not been told about yet.
  notify = true
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
      // Geofence points for the LoyaltyClass. This runs on every stamp, which
      // is also how a location added later reaches a café whose class already
      // exists: ensureLoyaltyClass compares and PATCHes. One extra indexed
      // read on a path that already does several, and a Google round-trip.
      locations: await loadMerchantLocations(row.merchant_id),
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
      const cfg = parseJson<{ stamps_required?: number; design?: Partial<CardDesign> }>(
        row.program_config
      );
      const stampsRequired = cfg.stamps_required ?? 0;
      if (stampsRequired <= 0) return;
      programForWallet = {
        programType: "stamp" as const,
        id: row.program_id,
        name: row.program_name,
        rewardText: row.reward_text,
        stampsRequired,
        // Carries through to the Google heroImage. The Apple path already had
        // the design; the Google path never did, which is why Android passes
        // showed no stamp artwork at all.
        design: cfg.design ?? null,
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

    // Not a plain null check: a card enrolled under a previous issuer carries
    // an object id that no longer resolves. Without this, every pre-existing
    // card takes the PATCH branch after an issuer change, PATCHes an object
    // that was never created, gets a 404, and the error is swallowed because
    // wallet calls are best-effort — so the card silently stops syncing while
    // stamps carry on working. Treat a foreign id as absent and create.
    if (!objectOnCurrentIssuer(row.google_wallet_object_id)) {
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

    if (notify) {
      await sendCardMessage({
        event,
        businessName: row.business_name,
        rewardText: row.reward_text,
        currentValue,
        thresholdValue,
        unitLabel,
        cardId,
      });
    }
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

/**
 * Add one stamp.
 *
 * `amountCents` is the optional sale amount for this visit (Day 15 revenue
 * capture). It is recorded alongside the stamp and never affects it — pass
 * null and the behaviour is byte-for-byte what it was before Day 15.
 */
export async function stampCardById(
  cardId: string,
  merchantId: string,
  amountCents: number | null = null
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
      `INSERT INTO card_events (merchant_id, card_id, event_type, delta_json, amount_cents, note)
       VALUES (?, ?, 'stamp', ?, ?, NULL)`,
      [
        merchantId,
        cardId,
        JSON.stringify({
          stamps_before: before,
          stamps_after: newState.stamps_current,
          stamps_required: stampsRequired,
        }),
        amountCents,
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
  merchantId: string,
  amountCents: number | null = null
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
    return redeemPointsCard(cardId, merchantId, amountCents);
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
      `INSERT INTO card_events (merchant_id, card_id, event_type, delta_json, amount_cents, note)
       VALUES (?, ?, 'redeem', ?, ?, NULL)`,
      [
        merchantId,
        cardId,
        JSON.stringify({
          stamps_required: stampsRequired,
          rewards_redeemed_before: rewardsBefore,
          rewards_redeemed_after: newState.rewards_redeemed,
        }),
        amountCents,
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
      `INSERT INTO card_events (merchant_id, card_id, event_type, delta_json, amount_cents, note)
       VALUES (?, ?, 'points_add', ?, ?, NULL)`,
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
        // Points transactions always carry an amount — it is the input that
        // drives the whole calculation — so revenue reporting gets it for
        // free, with no extra prompt for the merchant.
        euroToCents(amountEuros),
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
 * Take `amount` points off a card, oldest non-expired batch first.
 *
 * Extracted so redemption and manual adjustment deduct identically. Two
 * copies of a FIFO loop over a ledger would eventually disagree about which
 * batch to drain, and the symptom would be points expiring on the wrong date
 * — nearly impossible to notice and very hard to explain.
 *
 * Locks the batch rows. Reading inside a FOR UPDATE on the parent card row
 * already serialises callers, but the explicit lock here guards if that is
 * ever relaxed.
 *
 * Caller must have verified the balance. The trailing check is the backstop:
 * if a race somehow gets past it, abort rather than half-deduct.
 */
async function deductPointsFifo(
  conn: PoolConnection,
  cardId: string,
  amount: number
): Promise<void> {
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

  let toDeduct = amount;
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
    throw ApiError.badRequest("insufficient batched points");
  }
}

/**
 * Redeem a points-program reward: deduct `points_for_reward` from the oldest
 * non-expired batches (FIFO). Throws 400 if balance is below threshold.
 */
export async function redeemPointsCard(
  cardId: string,
  merchantId: string,
  amountCents: number | null = null
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

    await deductPointsFifo(conn, cardId, config.points_for_reward);

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
      `INSERT INTO card_events (merchant_id, card_id, event_type, delta_json, amount_cents, note)
       VALUES (?, ?, 'redeem', ?, ?, NULL)`,
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
        amountCents,
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
 * Attach a sale amount to an event that already happened, and return the
 * refreshed card.
 *
 * The scanner uses this rather than sending the amount up front: a stamp has
 * to apply the moment the QR is read, because the one-stamp-per-day rule can
 * reject it and making staff type an amount only to be told "already stamped
 * today" is the worse of the two orderings.
 *
 * Overwriting an existing amount is allowed — fixing a typo is a normal thing
 * to want, and the merchant owns their own numbers. Only the event types that
 * represent a visit can carry money; attaching revenue to a 'signup' or an
 * 'expire' would be meaningless and would corrupt the AOV denominator.
 */
export async function setCardEventAmount(
  eventId: number,
  cardId: string,
  merchantId: string,
  amountCents: number
): Promise<CardDetail> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT card_id, event_type FROM card_events
      WHERE id = ? AND card_id = ? AND merchant_id = ? LIMIT 1`,
    [eventId, cardId, merchantId]
  );
  if (rows.length === 0) throw ApiError.notFound("event not found");

  const eventType = rows[0].event_type as CardEvent["eventType"];
  if (eventType !== "stamp" && eventType !== "redeem" && eventType !== "points_add") {
    throw ApiError.badRequest(
      `cannot attach a sale amount to a '${eventType}' event`
    );
  }

  await pool.execute<ResultSetHeader>(
    "UPDATE card_events SET amount_cents = ? WHERE id = ? AND merchant_id = ?",
    [amountCents, eventId, merchantId]
  );

  const { detail } = await loadCardOutsideTransaction(cardId, merchantId);
  return detail;
}

// ---------------------------------------------------------------------------
// Manual adjustment — the only write the platform-admin dashboard makes to a
// café's data.
//
// Lives here, beside the other primitives, rather than in the admin routes,
// because it has to obey exactly the same invariants. It deliberately does NOT
// reuse them:
//
//  - `stampCardById` adds exactly +1 and throws at the threshold. Unusable for
//    a delta, and unusable for a correction *to* the threshold, which is the
//    common case ("their tenth scan failed").
//  - `addPointsToCard` takes EUROS and writes `amount_cents`. Routing an
//    administrative grant through it would fabricate revenue, and corrupt that
//    café's sales total and AOV — a support fix would silently alter their
//    business figures.
//
// ⚠️ The trap, stated once: for points cards `card_state.points_current` is a
// CACHE of SUM(points_batches.points_remaining). Writing it directly would
// display correctly, update the wallet pass, and then be silently reverted by
// the café's next real transaction, because `computePointsBalance` recomputes
// from the ledger. So grants insert a batch row and deductions go through
// `deductPointsFifo`. The ledger is the only thing that persists.
// ---------------------------------------------------------------------------

/** Absolute bound on one adjustment. A four-figure correction is already a conversation. */
export const MAX_ADJUST_DELTA = 10_000;

export interface ManualAdjustResult {
  detail: CardDetail;
  unit: "stamps" | "points";
  before: number;
  after: number;
}

/**
 * Move a card's balance by `delta`, with a stated reason, attributed to the
 * admin who did it.
 *
 * Takes a DELTA, not a target. A target ("set this to 7") invites a lost
 * update: the operator reads 5 on a page rendered a minute ago, the café
 * stamps twice, and "set to 7" silently discards those two stamps. A delta
 * composes with whatever else happened.
 */
export async function applyManualAdjust(
  cardId: string,
  delta: number,
  reason: string,
  actor: AdminActor
): Promise<ManualAdjustResult> {
  if (!Number.isInteger(delta) || delta === 0) {
    throw ApiError.badRequest("delta must be a non-zero whole number");
  }
  if (Math.abs(delta) > MAX_ADJUST_DELTA) {
    throw ApiError.badRequest(`delta must be between -${MAX_ADJUST_DELTA} and ${MAX_ADJUST_DELTA}`);
  }
  if (reason.trim().length < 3) {
    throw ApiError.badRequest("a reason is required");
  }

  // The admin surface does not know or care which café owns the card, but
  // every function below is tenant-scoped and must stay that way. Resolve the
  // tenant, then pass it in — rather than adding unscoped variants that could
  // later be called from a merchant-facing route.
  const [ownerRows] = await pool.execute<RowDataPacket[]>(
    `SELECT c.merchant_id, p.program_type
       FROM loyalty_cards c
       JOIN loyalty_programs p ON p.id = c.program_id
      WHERE c.id = ? LIMIT 1`,
    [cardId]
  );
  if (ownerRows.length === 0) throw ApiError.notFound("card not found");
  const merchantId = ownerRows[0].merchant_id as string;
  const programType = ownerRows[0].program_type as "stamp" | "points";

  let unit: "stamps" | "points";
  let before: number;
  let after: number;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    if (programType === "points") {
      unit = "points";
      const { state, config } = await loadPointsCardForUpdate(conn, cardId, merchantId);
      // From the ledger, not from state — see the warning above. The cached
      // column may already have drifted, and adjusting a drifted number would
      // bake the drift in.
      before = await computePointsBalance(conn, cardId);
      after = before + delta;

      if (after < 0) {
        throw ApiError.badRequest(
          `cannot remove ${Math.abs(delta)} points — the balance is ${before}`
        );
      }

      if (delta > 0) {
        // expires_at NULL on purpose: an administrative grant is a correction
        // for something that went wrong, and having it quietly evaporate on
        // the program's expiry clock would recreate the original complaint.
        await conn.execute<ResultSetHeader>(
          `INSERT INTO points_batches
             (id, card_id, merchant_id, points_earned, points_remaining, expires_at)
           VALUES (?, ?, ?, ?, ?, NULL)`,
          [randomUUID(), cardId, merchantId, delta, delta]
        );
      } else {
        await deductPointsFifo(conn, cardId, -delta);
      }

      // Recomputed rather than assumed: this is the value the next
      // transaction will also arrive at, so the cache cannot drift.
      const newBalance = await computePointsBalance(conn, cardId);
      const newState: PointsCardState = {
        type: "points",
        points_current: newBalance,
        // Lifetime moves with the correction — a grant really was earned and a
        // clawback really was not — but never below the live balance, which
        // would be an impossible card.
        total_lifetime: Math.max(newBalance, state.total_lifetime + delta),
        rewards_redeemed: state.rewards_redeemed,
        total_expired: state.total_expired,
      };
      after = newBalance;

      await conn.execute<ResultSetHeader>(
        `UPDATE loyalty_cards
            SET card_state = ?, last_event_at = CURRENT_TIMESTAMP
          WHERE id = ? AND merchant_id = ?`,
        [JSON.stringify(newState), cardId, merchantId]
      );
      await writeAdjustEvent(conn, {
        merchantId,
        cardId,
        actor,
        reason,
        delta,
        unit,
        before,
        after,
        threshold: config.points_for_reward,
      });
    } else {
      unit = "stamps";
      const { state, stampsRequired } = await loadCardForUpdate(conn, cardId, merchantId);
      before = state.stamps_current;
      after = before + delta;

      if (after < 0) {
        throw ApiError.badRequest(
          `cannot remove ${Math.abs(delta)} stamps — the card has ${before}`
        );
      }
      // Above the threshold is a state the ordinary stamp path refuses to
      // create, so creating it here would leave a card the café cannot stamp
      // and cannot explain. Landing exactly ON the threshold is allowed and is
      // the common case.
      if (after > stampsRequired) {
        throw ApiError.badRequest(
          `that would leave ${after} stamps on a ${stampsRequired}-stamp card — ` +
            "redeem the reward instead"
        );
      }

      const newState: StampCardState = {
        type: "stamp",
        stamps_current: after,
        total_lifetime: Math.max(after, state.total_lifetime + delta),
        rewards_redeemed: state.rewards_redeemed,
      };

      await conn.execute<ResultSetHeader>(
        `UPDATE loyalty_cards
            SET card_state = ?, last_event_at = CURRENT_TIMESTAMP
          WHERE id = ? AND merchant_id = ?`,
        [JSON.stringify(newState), cardId, merchantId]
      );
      await writeAdjustEvent(conn, {
        merchantId,
        cardId,
        actor,
        reason,
        delta,
        unit,
        before,
        after,
        threshold: stampsRequired,
      });
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  // notify: false — the pass must show the corrected balance, but the customer
  // did nothing. Pushing "You earned a stamp!" for a change they never made,
  // or announcing a reduction nobody has explained to them yet, is worse than
  // letting them see the right number the next time they look.
  await syncCardToWallet(cardId, merchantId, "stamp", false);
  const { detail } = await loadCardOutsideTransaction(cardId, merchantId);
  return { detail, unit, before, after };
}

/**
 * The two audit rows for one adjustment, both inside the caller's transaction.
 *
 * Two layers, and the first is the one that matters:
 *
 *  - `card_events` with `event_type = 'manual_adjust'` — the enum value has
 *    existed since migration 001 and has never been used. It puts the change
 *    where the MERCHANT can see it, on their own dashboard, labelled "Adjusted
 *    by OnUsClub". An operator changing a café's data invisibly is the real
 *    risk in this feature; the fix is that they cannot do it invisibly.
 *    `staff_user_id` carries who.
 *
 *    Note `amount_cents` stays NULL and `setCardEventAmount` refuses to attach
 *    money to a `manual_adjust`, so an adjustment can never pollute that
 *    café's revenue or AOV.
 *
 *  - `admin_audit_log` — operator-side, with before/after. Written on the same
 *    connection, so it commits with the change: a mutation that forgets to
 *    audit itself cannot commit.
 */
async function writeAdjustEvent(
  conn: PoolConnection,
  e: {
    merchantId: string;
    cardId: string;
    actor: AdminActor;
    reason: string;
    delta: number;
    unit: "stamps" | "points";
    before: number;
    after: number;
    threshold: number;
  }
): Promise<void> {
  await conn.execute<ResultSetHeader>(
    `INSERT INTO card_events
       (merchant_id, card_id, staff_user_id, event_type, delta_json, amount_cents, note)
     VALUES (?, ?, ?, 'manual_adjust', ?, NULL, ?)`,
    [
      e.merchantId,
      e.cardId,
      e.actor.userId,
      JSON.stringify({
        unit: e.unit,
        delta: e.delta,
        balance_before: e.before,
        balance_after: e.after,
        threshold: e.threshold,
        reason: e.reason,
        by: e.actor.email,
      }),
      // Shown verbatim on the café's own dashboard. Their customer may well
      // ask them about it, so the café needs the reason, not a reference.
      `${e.delta > 0 ? "+" : ""}${e.delta} ${e.unit} by OnUsClub support: ${e.reason}`,
    ]
  );

  await writeAuditLog(conn, {
    actor: e.actor,
    action: "card.adjust",
    merchantId: e.merchantId,
    targetType: "card",
    targetId: e.cardId,
    reason: e.reason,
    before: { unit: e.unit, balance: e.before },
    after: { unit: e.unit, balance: e.after, delta: e.delta },
  });
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
