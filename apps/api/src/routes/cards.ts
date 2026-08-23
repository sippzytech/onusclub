import { randomBytes, randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import {
  AddPointsInput,
  CardActionInput,
  CardCreateInput,
  CardEventAmountInput,
  euroToCents,
  type Card,
  type CardDetail,
} from "@onusclub/shared";
import { pool } from "../db/pool.js";
import { authContext, requireAuth } from "../auth/middleware.js";
import { env } from "../config.js";
import { ApiError } from "../errors.js";
import { logger } from "../logger.js";
import {
  addPointsToCard,
  getCardDetail,
  redeemCardById,
  setCardEventAmount,
  stampCardById,
  syncCardToWallet,
} from "../cards/operations.js";
import { buildSaveJwt, saveUrl } from "../wallet/loyalty.js";
import { sendEmail } from "../email/client.js";
import { walletInviteEmail } from "../email/templates.js";

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
  program_type: "stamp" | "points";
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

interface InviteRow extends RowDataPacket {
  google_wallet_object_id: string | null;
  business_name: string;
  customer_name: string | null;
  customer_email: string | null;
  reward_text: string;
  program_config: unknown;
}

function parseJson<T>(value: unknown): T {
  return typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
}

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

function rowToCard(row: CardRow): Card {
  return {
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
  };
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
 * Send the wallet save link to the customer's email if we have one. Runs
 * after the wallet object has been created. Best-effort: failures (no email,
 * Resend down, wallet offline) are logged and swallowed.
 */
async function sendWalletInviteEmail(
  cardId: string,
  merchantId: string
): Promise<boolean> {
  try {
    const [rows] = await pool.execute<InviteRow[]>(
      `SELECT c.google_wallet_object_id,
              m.business_name,
              cu.name AS customer_name, cu.email AS customer_email,
              p.reward_text, p.config_json AS program_config
         FROM loyalty_cards c
         JOIN merchants m ON m.id = c.merchant_id
         JOIN customers cu ON cu.id = c.customer_id
         JOIN loyalty_programs p ON p.id = c.program_id
        WHERE c.id = ? AND c.merchant_id = ?
        LIMIT 1`,
      [cardId, merchantId]
    );
    if (rows.length === 0) return false;
    const row = rows[0];
    if (!row.customer_email) {
      logger.info({ cardId }, "email skipped — no customer email");
      return false;
    }
    if (!row.google_wallet_object_id) {
      logger.info({ cardId }, "email skipped — wallet object not yet created");
      return false;
    }
    const token = await buildSaveJwt(cardId);
    if (!token) {
      logger.info({ cardId }, "email skipped — wallet save JWT unavailable");
      return false;
    }
    const cfg = parseJson<{ stamps_required?: number }>(row.program_config);
    const { appleWalletEnabled } = await import("../wallet-apple/client.js");
    const applePassUrl = (await appleWalletEnabled())
      ? `${env.BASE_URL_API.replace(/\/$/, "")}/v1/public/c/${row.qr_token}/apple-pass`
      : null;
    const { subject, html, text } = walletInviteEmail({
      businessName: row.business_name,
      customerName: row.customer_name,
      rewardText: row.reward_text,
      stampsRequired: cfg.stamps_required ?? 0,
      walletSaveUrl: saveUrl(token),
      applePassUrl,
    });
    const result = await sendEmail({
      to: row.customer_email,
      subject,
      html,
      text,
    });
    return result.ok;
  } catch (err) {
    logger.error({ err, cardId }, "wallet invite email failed");
    return false;
  }
}

// ---------- create card ----------

cardsRouter.post("/", requireAuth, async (req: Request, res: Response<Card>) => {
  const ctx = authContext(req);
  const input = CardCreateInput.parse(req.body);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

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
    if (prog.program_type !== "stamp" && prog.program_type !== "points") {
      throw ApiError.badRequest(`program type '${prog.program_type}' is not supported yet`);
    }

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
    const initialState =
      prog.program_type === "points"
        ? {
            type: "points" as const,
            points_current: 0,
            total_lifetime: 0,
            rewards_redeemed: 0,
            total_expired: 0,
          }
        : {
            type: "stamp" as const,
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

    // Mirror the new card to Google Wallet + send the welcome notification.
    await syncCardToWallet(id, ctx.merchantId, "signup");

    // If the customer has an email, send them the wallet save link.
    await sendWalletInviteEmail(id, ctx.merchantId);

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
  return res.json(await getCardDetail(req.params.id, ctx.merchantId));
});

// ---------- stamp ----------

// Body is optional: `{}` or no body stamps exactly as it did pre-Day-15,
// `{ amount: 12.5 }` also records the sale for revenue reporting.

cardsRouter.post(
  "/:id/stamp",
  requireAuth,
  async (req: Request, res: Response<CardDetail>) => {
    const ctx = authContext(req);
    const input = CardActionInput.parse(req.body ?? {});
    const amountCents = input.amount === undefined ? null : euroToCents(input.amount);
    return res.json(await stampCardById(req.params.id, ctx.merchantId, amountCents));
  }
);

// ---------- redeem ----------
//
// Single redeem endpoint for both stamp and points cards. redeemCardById
// dispatches by program_type internally.

cardsRouter.post(
  "/:id/redeem",
  requireAuth,
  async (req: Request, res: Response<CardDetail>) => {
    const ctx = authContext(req);
    const input = CardActionInput.parse(req.body ?? {});
    const amountCents = input.amount === undefined ? null : euroToCents(input.amount);
    return res.json(await redeemCardById(req.params.id, ctx.merchantId, amountCents));
  }
);

// ---------- attach a sale amount to an event that already happened ----------
//
// The scanner's path for stamp cards: apply first (so the once-per-day rule
// answers instantly), then optionally record what the customer spent.

cardsRouter.patch(
  "/:id/events/:eventId/amount",
  requireAuth,
  async (req: Request, res: Response<CardDetail>) => {
    const ctx = authContext(req);
    const input = CardEventAmountInput.parse(req.body);
    const eventId = Number(req.params.eventId);
    if (!Number.isInteger(eventId) || eventId <= 0) {
      throw ApiError.badRequest("eventId must be a positive integer");
    }
    return res.json(
      await setCardEventAmount(
        eventId,
        req.params.id,
        ctx.merchantId,
        euroToCents(input.amount)
      )
    );
  }
);

// ---------- add points (points programs only) ----------

cardsRouter.post(
  "/:id/add-points",
  requireAuth,
  async (req: Request, res: Response<CardDetail>) => {
    const ctx = authContext(req);
    const input = AddPointsInput.parse(req.body);
    return res.json(await addPointsToCard(req.params.id, ctx.merchantId, input.amount));
  }
);
