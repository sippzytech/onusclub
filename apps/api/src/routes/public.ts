// Customer-facing endpoints. NO authentication — these power the public
// /m/[slug] landing page where a customer scans a QR, fills in their details,
// and gets a wallet pass added to their phone.
//
// Tenant scoping is enforced by the slug: every lookup / write is scoped to
// the merchant that owns the slug. We never accept a merchant id from the
// client.

import { randomBytes, randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import {
  PublicEnrolInput,
  type PublicCardView,
  type PublicEnrolResult,
  type PublicMerchant,
  type StampCardState,
} from "@onusclub/shared";
import { pool } from "../db/pool.js";
import { env } from "../config.js";
import { ApiError } from "../errors.js";
import { syncCardToWallet } from "../cards/operations.js";
import { buildSaveJwt, saveUrl } from "../wallet/loyalty.js";

export const publicRouter: Router = Router();

interface MerchantRow extends RowDataPacket {
  id: string;
  business_name: string;
  brand_color: string | null;
  logo_url: string | null;
  public_slug: string;
  status: "active" | "suspended" | "trial";
}

interface ProgramRow extends RowDataPacket {
  id: string;
  name: string;
  config_json: unknown;
  reward_text: string;
}

interface CustomerRow extends RowDataPacket {
  id: string;
}

interface CardLookupRow extends RowDataPacket {
  id: string;
}

function parseJson<T>(value: unknown): T {
  return typeof value === "string" ? (JSON.parse(value) as T) : (value as T);
}

// GET /v1/public/m/:slug — merchant + active programs for the public page.
publicRouter.get(
  "/m/:slug",
  async (req: Request, res: Response<PublicMerchant>) => {
    const [merchants] = await pool.execute<MerchantRow[]>(
      `SELECT id, business_name, brand_color, logo_url, public_slug, status
         FROM merchants WHERE public_slug = ? LIMIT 1`,
      [req.params.slug]
    );
    if (merchants.length === 0) throw ApiError.notFound("merchant not found");
    const m = merchants[0];
    if (m.status === "suspended") throw ApiError.notFound("merchant not found");

    const [programs] = await pool.execute<ProgramRow[]>(
      `SELECT id, name, config_json, reward_text
         FROM loyalty_programs
        WHERE merchant_id = ? AND active = TRUE AND program_type = 'stamp'
        ORDER BY created_at DESC`,
      [m.id]
    );

    return res.json({
      businessName: m.business_name,
      brandColor: m.brand_color,
      logoUrl: m.logo_url,
      publicSlug: m.public_slug,
      programs: programs.map((p) => {
        const cfg = parseJson<{ stamps_required?: number }>(p.config_json);
        return {
          id: p.id,
          name: p.name,
          stampsRequired: cfg.stamps_required ?? 0,
          rewardText: p.reward_text,
        };
      }),
    });
  }
);

// POST /v1/public/m/:slug/enrol — customer-facing self-enrolment.
publicRouter.post(
  "/m/:slug/enrol",
  async (req: Request, res: Response<PublicEnrolResult>) => {
    const input = PublicEnrolInput.parse(req.body);

    const [merchants] = await pool.execute<MerchantRow[]>(
      `SELECT id, business_name, brand_color, logo_url, public_slug, status
         FROM merchants WHERE public_slug = ? LIMIT 1`,
      [req.params.slug]
    );
    if (merchants.length === 0) throw ApiError.notFound("merchant not found");
    const m = merchants[0];
    if (m.status === "suspended") throw ApiError.notFound("merchant not found");
    const merchantId = m.id;

    // Verify the selected program belongs to this merchant.
    const [programs] = await pool.execute<ProgramRow[]>(
      `SELECT id, name, config_json, reward_text
         FROM loyalty_programs
        WHERE id = ? AND merchant_id = ? AND active = TRUE LIMIT 1`,
      [input.programId, merchantId]
    );
    if (programs.length === 0) throw ApiError.notFound("program not found");

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Match an existing customer by phone or email to avoid duplicates when
      // the same person scans the QR twice.
      let customerId: string | null = null;
      if (input.email) {
        const [rows] = await conn.execute<CustomerRow[]>(
          `SELECT id FROM customers WHERE merchant_id = ? AND email = ? LIMIT 1`,
          [merchantId, input.email]
        );
        if (rows.length > 0) customerId = rows[0].id;
      }
      if (!customerId && input.phone) {
        const [rows] = await conn.execute<CustomerRow[]>(
          `SELECT id FROM customers WHERE merchant_id = ? AND phone = ? LIMIT 1`,
          [merchantId, input.phone]
        );
        if (rows.length > 0) customerId = rows[0].id;
      }

      const isExistingCustomer = customerId !== null;

      if (!customerId) {
        customerId = randomUUID();
        await conn.execute<ResultSetHeader>(
          `INSERT INTO customers (id, merchant_id, name, phone, email, birthday)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            customerId,
            merchantId,
            input.name,
            input.phone ?? null,
            input.email ?? null,
            input.birthday ?? null,
          ]
        );
      }

      // If they already have an active card for this program, return it (no
      // duplicate enrolment).
      const [existingCards] = await conn.execute<CardLookupRow[]>(
        `SELECT id FROM loyalty_cards
          WHERE customer_id = ? AND program_id = ? AND status = 'active'
          LIMIT 1`,
        [customerId, input.programId]
      );

      let cardId: string;
      if (existingCards.length > 0) {
        cardId = existingCards[0].id;
        await conn.commit();
      } else {
        cardId = randomUUID();
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
            cardId,
            merchantId,
            customerId,
            input.programId,
            JSON.stringify(initialState),
            qrToken,
          ]
        );
        await conn.execute<ResultSetHeader>(
          `INSERT INTO card_events (merchant_id, card_id, event_type, delta_json, note)
           VALUES (?, ?, 'signup', ?, NULL)`,
          [merchantId, cardId, JSON.stringify({ via: "public_qr_signup" })]
        );
        await conn.commit();

        // Wallet sync + welcome notification (best-effort, outside tx).
        await syncCardToWallet(cardId, merchantId, "signup");
      }

      const token = await buildSaveJwt(cardId);
      const walletSaveUrl = token ? saveUrl(token) : null;

      return res.status(isExistingCustomer ? 200 : 201).json({
        walletSaveUrl,
        existing: existingCards.length > 0,
      });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }
);

// GET /v1/public/c/:qrToken — customer's own card view. No auth: the qr_token
// itself is the access credential (32 bytes of crypto-random hex). Returns
// sanitised data only — no events, no other customers, no merchant secrets.
interface CardViewRow extends RowDataPacket {
  card_id: string;
  qr_token: string;
  card_state: unknown;
  google_wallet_object_id: string | null;
  status: "active" | "blocked" | "expired";
  business_name: string;
  brand_color: string | null;
  customer_name: string | null;
  program_name: string;
  reward_text: string;
  program_config: unknown;
}

publicRouter.get(
  "/c/:qrToken",
  async (req: Request, res: Response<PublicCardView>) => {
    const qrToken = req.params.qrToken;
    if (!/^[0-9a-f]{64}$/i.test(qrToken)) {
      throw ApiError.notFound("card not found");
    }
    const [rows] = await pool.execute<CardViewRow[]>(
      `SELECT c.id AS card_id, c.qr_token, c.card_state,
              c.google_wallet_object_id, c.status,
              m.business_name, m.brand_color,
              cu.name AS customer_name,
              p.name AS program_name, p.reward_text,
              p.config_json AS program_config
         FROM loyalty_cards c
         JOIN merchants m ON m.id = c.merchant_id
         JOIN customers cu ON cu.id = c.customer_id
         JOIN loyalty_programs p ON p.id = c.program_id
        WHERE c.qr_token = ? LIMIT 1`,
      [qrToken]
    );
    if (rows.length === 0) throw ApiError.notFound("card not found");
    const row = rows[0];
    const state =
      typeof row.card_state === "string"
        ? (JSON.parse(row.card_state) as StampCardState)
        : (row.card_state as StampCardState);
    const cfg =
      typeof row.program_config === "string"
        ? (JSON.parse(row.program_config) as { stamps_required?: number })
        : (row.program_config as { stamps_required?: number });

    // Issue a fresh save URL only if the wallet object exists.
    let walletSaveUrl: string | null = null;
    if (row.google_wallet_object_id) {
      const token = await buildSaveJwt(row.card_id);
      if (token) walletSaveUrl = saveUrl(token);
    }

    return res.json({
      businessName: row.business_name,
      brandColor: row.brand_color,
      customerName: row.customer_name,
      programName: row.program_name,
      rewardText: row.reward_text,
      stampsCurrent: state.stamps_current,
      stampsRequired: cfg.stamps_required ?? 0,
      rewardsRedeemed: state.rewards_redeemed,
      status: row.status,
      walletSaveUrl,
    });
  }
);

// GET /v1/public/c/:qrToken/apple-pass — returns a signed .pkpass for iOS
// Wallet. Same access model as /v1/public/c/:qrToken (the 64-char qr_token
// is the credential). iOS Safari opening this URL prompts to save the pass.
interface AppleCardRow extends RowDataPacket {
  card_id: string;
  qr_token: string;
  apple_auth_token: string | null;
  card_state: unknown;
  status: "active" | "blocked" | "expired";
  merchant_id: string;
  business_name: string;
  brand_color: string | null;
  customer_name: string | null;
  program_id: string;
  program_name: string;
  reward_text: string;
  program_config: unknown;
}

publicRouter.get("/c/:qrToken/apple-pass", async (req: Request, res: Response) => {
  const qrToken = req.params.qrToken;
  if (!/^[0-9a-f]{64}$/i.test(qrToken)) {
    throw ApiError.notFound("card not found");
  }

  const [rows] = await pool.execute<AppleCardRow[]>(
    `SELECT c.id AS card_id, c.qr_token, c.apple_auth_token, c.card_state, c.status,
            m.id AS merchant_id, m.business_name, m.brand_color,
            cu.name AS customer_name,
            p.id AS program_id, p.name AS program_name, p.reward_text,
            p.config_json AS program_config
       FROM loyalty_cards c
       JOIN merchants m ON m.id = c.merchant_id
       JOIN customers cu ON cu.id = c.customer_id
       JOIN loyalty_programs p ON p.id = c.program_id
      WHERE c.qr_token = ? LIMIT 1`,
    [qrToken]
  );
  if (rows.length === 0) throw ApiError.notFound("card not found");
  const row = rows[0];
  if (row.status !== "active") {
    throw ApiError.badRequest("card is not active");
  }

  // Lazy-generate per-card Apple Wallet auth token. Stable across downloads
  // (a re-add of the same pass must keep the same authenticationToken or
  // Wallet's web-service calls won't match).
  let appleAuthToken = row.apple_auth_token;
  if (!appleAuthToken) {
    appleAuthToken = randomBytes(32).toString("hex");
    await pool.execute(
      "UPDATE loyalty_cards SET apple_auth_token = ? WHERE id = ?",
      [appleAuthToken, row.card_id]
    );
  }

  const state =
    typeof row.card_state === "string"
      ? (JSON.parse(row.card_state) as StampCardState)
      : (row.card_state as StampCardState);
  const cfg =
    typeof row.program_config === "string"
      ? (JSON.parse(row.program_config) as { stamps_required?: number })
      : (row.program_config as { stamps_required?: number });

  // Lazy import — avoids loading passkit-generator at module-init time when
  // the api is doing other unrelated work (and keeps the cold-start lean).
  const { buildPkPass } = await import("../wallet-apple/pass-builder.js");
  const pkPassBuffer = await buildPkPass(
    {
      id: row.merchant_id,
      businessName: row.business_name,
      brandColor: row.brand_color,
    },
    {
      id: row.program_id,
      name: row.program_name,
      rewardText: row.reward_text,
      stampsRequired: cfg.stamps_required ?? 0,
    },
    {
      id: row.card_id,
      qrToken: row.qr_token,
      state,
      customerName: row.customer_name,
    },
    // iOS Wallet rejects any pass whose webServiceURL isn't HTTPS — and the
    // device must be able to reach the host. localhost / plain HTTP would
    // make Safari refuse to open the pass entirely. So we only opt-in to
    // live updates when BASE_URL_API is HTTPS; otherwise emit a static
    // pass (Day 11 behavior) and the customer still gets a working pass,
    // just without auto-refresh.
    env.BASE_URL_API.startsWith("https://")
      ? {
          webServiceURL: `${env.BASE_URL_API.replace(/\/$/, "")}/v1/apple-wallet`,
          authenticationToken: appleAuthToken,
        }
      : undefined
  );

  if (!pkPassBuffer) {
    throw new ApiError(
      503,
      "apple_wallet_unavailable",
      "Apple Wallet is not configured on this server"
    );
  }

  res.setHeader("Content-Type", "application/vnd.apple.pkpass");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="onusclub-${row.card_id}.pkpass"`
  );
  // Disable cache so an updated pass isn't served stale by the customer's
  // browser if they re-tap the link after a stamp.
  res.setHeader("Cache-Control", "no-store");
  res.send(pkPassBuffer);
});
