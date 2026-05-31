import { randomBytes, randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import {
  CardCreateInput,
  type Card,
  type CardDetail,
  type CardEvent,
  type StampCardState,
} from "@stampdeck/shared";
import { pool } from "../db/pool.js";
import { authContext, requireAuth } from "../auth/middleware.js";
import { ApiError } from "../errors.js";

export const cardsRouter: Router = Router();

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

interface ProgramRow extends RowDataPacket {
  id: string;
  program_type: string;
  config_json: unknown;
}

interface CountRow extends RowDataPacket {
  c: number;
}

interface EventRow extends RowDataPacket {
  id: number;
  card_id: string;
  event_type: CardEvent["eventType"];
  delta_json: unknown;
  note: string | null;
  created_at: Date;
}

function parseJson<T>(value: unknown): T {
  return typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
}

function rowToCard(row: CardRow): Card {
  const cfg = parseJson<{ stamps_required?: number }>(row.program_config);
  return {
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
  };
}

function rowToEvent(row: EventRow): CardEvent {
  return {
    id: row.id,
    cardId: row.card_id,
    eventType: row.event_type,
    deltaJson: parseJson(row.delta_json),
    note: row.note,
    createdAt: new Date(row.created_at).toISOString(),
  };
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

// ---------- create card ----------

cardsRouter.post("/", requireAuth, async (req: Request, res: Response<Card>) => {
  const ctx = authContext(req);
  const input = CardCreateInput.parse(req.body);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Verify customer + program both belong to this merchant.
    const [customerCheck] = await conn.execute<CountRow[]>(
      "SELECT COUNT(*) AS c FROM customers WHERE id = ? AND merchant_id = ?",
      [input.customerId, ctx.merchantId]
    );
    if (customerCheck[0].c === 0) throw ApiError.notFound("customer not found");

    const [programRows] = await conn.execute<ProgramRow[]>(
      "SELECT id, program_type, config_json FROM loyalty_programs WHERE id = ? AND merchant_id = ? LIMIT 1",
      [input.programId, ctx.merchantId]
    );
    if (programRows.length === 0) throw ApiError.notFound("program not found");
    const prog = programRows[0];
    if (prog.program_type !== "stamp") {
      throw ApiError.badRequest("only stamp programs are supported in Phase 1");
    }

    // Prevent duplicate active card for the same (customer, program) — keeps the
    // enrol UX idempotent in practice without a unique index across nullable
    // columns.
    const [dupRows] = await conn.execute<CountRow[]>(
      `SELECT COUNT(*) AS c FROM loyalty_cards
        WHERE customer_id = ? AND program_id = ? AND status = 'active'`,
      [input.customerId, input.programId]
    );
    if (dupRows[0].c > 0) {
      throw ApiError.conflict("customer already has an active card for this program");
    }

    const id = randomUUID();
    const qrToken = randomBytes(32).toString("hex");
    const initialState: StampCardState = {
      type: "stamp",
      stamps_current: 0,
      total_lifetime: 0,
      rewards_redeemed: 0,
    };

    await conn.execute<ResultSetHeader>(
      `INSERT INTO loyalty_cards
         (id, merchant_id, customer_id, program_id, card_state, qr_token, status)
       VALUES (?, ?, ?, ?, ?, ?, 'active')`,
      [
        id,
        ctx.merchantId,
        input.customerId,
        input.programId,
        JSON.stringify(initialState),
        qrToken,
      ]
    );

    await conn.execute<ResultSetHeader>(
      `INSERT INTO card_events (merchant_id, card_id, event_type, delta_json, note)
       VALUES (?, ?, 'signup', ?, NULL)`,
      [ctx.merchantId, id, JSON.stringify({ via: "owner_dashboard" })]
    );

    const [rows] = await conn.execute<CardRow[]>(
      `${CARD_SELECT} WHERE c.id = ? AND c.merchant_id = ?`,
      [id, ctx.merchantId]
    );
    await conn.commit();
    return res.status(201).json(rowToCard(rows[0]));
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

// ---------- list cards ----------

cardsRouter.get(
  "/",
  requireAuth,
  async (req: Request, res: Response<{ cards: Card[] }>) => {
    const ctx = authContext(req);
    const [rows] = await pool.execute<CardRow[]>(
      `${CARD_SELECT} WHERE c.merchant_id = ? ORDER BY c.created_at DESC`,
      [ctx.merchantId]
    );
    return res.json({ cards: rows.map(rowToCard) });
  }
);

// ---------- card detail ----------

cardsRouter.get("/:id", requireAuth, async (req: Request, res: Response<CardDetail>) => {
  const ctx = authContext(req);
  const id = req.params.id;

  const [cardRows] = await pool.execute<CardRow[]>(
    `${CARD_SELECT} WHERE c.id = ? AND c.merchant_id = ?`,
    [id, ctx.merchantId]
  );
  if (cardRows.length === 0) throw ApiError.notFound("card not found");

  const [eventRows] = await pool.execute<EventRow[]>(
    `SELECT id, card_id, event_type, delta_json, note, created_at
       FROM card_events
      WHERE card_id = ? AND merchant_id = ?
      ORDER BY id DESC
      LIMIT 50`,
    [id, ctx.merchantId]
  );

  return res.json({
    card: rowToCard(cardRows[0]),
    events: eventRows.map(rowToEvent),
  });
});

// ---------- stamp ----------
// Uses SELECT … FOR UPDATE so two concurrent stamp calls cannot double-count.

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

cardsRouter.post(
  "/:id/stamp",
  requireAuth,
  async (req: Request, res: Response<CardDetail>) => {
    const ctx = authContext(req);
    const id = req.params.id;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const { state, stampsRequired } = await loadCardForUpdate(conn, id, ctx.merchantId);

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
        [JSON.stringify(newState), id, ctx.merchantId]
      );
      await conn.execute<ResultSetHeader>(
        `INSERT INTO card_events (merchant_id, card_id, event_type, delta_json, note)
         VALUES (?, ?, 'stamp', ?, NULL)`,
        [
          ctx.merchantId,
          id,
          JSON.stringify({
            stamps_before: before,
            stamps_after: newState.stamps_current,
            stamps_required: stampsRequired,
          }),
        ]
      );

      const [cardRows] = await conn.execute<CardRow[]>(
        `${CARD_SELECT} WHERE c.id = ? AND c.merchant_id = ?`,
        [id, ctx.merchantId]
      );
      const [eventRows] = await conn.execute<EventRow[]>(
        `SELECT id, card_id, event_type, delta_json, note, created_at
           FROM card_events WHERE card_id = ? AND merchant_id = ?
           ORDER BY id DESC LIMIT 50`,
        [id, ctx.merchantId]
      );

      await conn.commit();
      return res.json({
        card: rowToCard(cardRows[0]),
        events: eventRows.map(rowToEvent),
      });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }
);

// ---------- redeem ----------

cardsRouter.post(
  "/:id/redeem",
  requireAuth,
  async (req: Request, res: Response<CardDetail>) => {
    const ctx = authContext(req);
    const id = req.params.id;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const { state, stampsRequired } = await loadCardForUpdate(conn, id, ctx.merchantId);

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
        [JSON.stringify(newState), id, ctx.merchantId]
      );
      await conn.execute<ResultSetHeader>(
        `INSERT INTO card_events (merchant_id, card_id, event_type, delta_json, note)
         VALUES (?, ?, 'redeem', ?, NULL)`,
        [
          ctx.merchantId,
          id,
          JSON.stringify({
            stamps_required: stampsRequired,
            rewards_redeemed_before: rewardsBefore,
            rewards_redeemed_after: newState.rewards_redeemed,
          }),
        ]
      );

      const [cardRows] = await conn.execute<CardRow[]>(
        `${CARD_SELECT} WHERE c.id = ? AND c.merchant_id = ?`,
        [id, ctx.merchantId]
      );
      const [eventRows] = await conn.execute<EventRow[]>(
        `SELECT id, card_id, event_type, delta_json, note, created_at
           FROM card_events WHERE card_id = ? AND merchant_id = ?
           ORDER BY id DESC LIMIT 50`,
        [id, ctx.merchantId]
      );

      await conn.commit();
      return res.json({
        card: rowToCard(cardRows[0]),
        events: eventRows.map(rowToEvent),
      });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }
);
