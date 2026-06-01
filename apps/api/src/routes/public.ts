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
  type PublicEnrolResult,
  type PublicMerchant,
  type StampCardState,
} from "@stampdeck/shared";
import { pool } from "../db/pool.js";
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
