import { Router, type Request, type Response } from "express";
import type { RowDataPacket } from "mysql2";
import type { WalletLink } from "@stampdeck/shared";
import { pool } from "../db/pool.js";
import { authContext, requireAuth } from "../auth/middleware.js";
import { env } from "../config.js";
import { ApiError } from "../errors.js";
import { buildSaveJwt, saveUrl } from "../wallet/loyalty.js";
import { walletEnabled } from "../wallet/client.js";
import { sendEmail } from "../email/client.js";
import { walletInviteEmail } from "../email/templates.js";

export const walletRouter: Router = Router();

interface CardRow extends RowDataPacket {
  id: string;
  google_wallet_object_id: string | null;
}

interface InviteRow extends RowDataPacket {
  id: string;
  qr_token: string;
  google_wallet_object_id: string | null;
  business_name: string;
  customer_name: string | null;
  customer_email: string | null;
  reward_text: string;
  program_config: unknown;
}

walletRouter.get(
  "/cards/:id/wallet-link",
  requireAuth,
  async (req: Request, res: Response<WalletLink>) => {
    const ctx = authContext(req);
    const id = req.params.id;

    const [rows] = await pool.execute<CardRow[]>(
      "SELECT id, google_wallet_object_id FROM loyalty_cards WHERE id = ? AND merchant_id = ? LIMIT 1",
      [id, ctx.merchantId]
    );
    if (rows.length === 0) throw ApiError.notFound("card not found");
    const row = rows[0];

    if (!(await walletEnabled())) {
      return res.json({ available: false, url: null });
    }
    if (!row.google_wallet_object_id) {
      // Object hasn't been mirrored to Google yet (Wallet may have been
      // offline when the card was enrolled). The save JWT would refer to a
      // non-existent object, so report unavailable instead of issuing a
      // broken link.
      return res.json({ available: false, url: null });
    }

    const token = await buildSaveJwt(id);
    if (!token) return res.json({ available: false, url: null });

    return res.json({ available: true, url: saveUrl(token) });
  }
);

/**
 * Re-send the wallet save link to the customer's email. Same content as the
 * automatic one fired on enrolment — useful when the original lands in spam
 * or the customer asks for a fresh copy.
 */
walletRouter.post(
  "/cards/:id/resend-invite",
  requireAuth,
  async (
    req: Request,
    res: Response<{ ok: boolean; reason?: string; emailedTo?: string }>
  ) => {
    const ctx = authContext(req);
    const id = req.params.id;

    const [rows] = await pool.execute<InviteRow[]>(
      `SELECT c.id, c.qr_token, c.google_wallet_object_id,
              m.business_name,
              cu.name AS customer_name, cu.email AS customer_email,
              p.reward_text, p.config_json AS program_config
         FROM loyalty_cards c
         JOIN merchants m ON m.id = c.merchant_id
         JOIN customers cu ON cu.id = c.customer_id
         JOIN loyalty_programs p ON p.id = c.program_id
        WHERE c.id = ? AND c.merchant_id = ?
        LIMIT 1`,
      [id, ctx.merchantId]
    );
    if (rows.length === 0) throw ApiError.notFound("card not found");
    const row = rows[0];

    if (!row.customer_email) {
      return res.status(400).json({ ok: false, reason: "no email on file for this customer" });
    }
    if (!row.google_wallet_object_id) {
      return res
        .status(400)
        .json({ ok: false, reason: "wallet object not yet created; retry shortly" });
    }
    const token = await buildSaveJwt(id);
    if (!token) {
      return res.status(503).json({ ok: false, reason: "wallet not configured" });
    }
    const cfg =
      typeof row.program_config === "string"
        ? (JSON.parse(row.program_config) as { stamps_required?: number })
        : (row.program_config as { stamps_required?: number });

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
    if (!result.ok) {
      return res.status(502).json({ ok: false, reason: result.error ?? "email send failed" });
    }
    return res.json({ ok: true, emailedTo: row.customer_email });
  }
);
