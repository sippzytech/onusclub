import { Router, type Request, type Response } from "express";
import type { RowDataPacket } from "mysql2";
import type { WalletLink } from "@stampdeck/shared";
import { pool } from "../db/pool.js";
import { authContext, requireAuth } from "../auth/middleware.js";
import { ApiError } from "../errors.js";
import { buildSaveJwt, saveUrl } from "../wallet/loyalty.js";
import { walletEnabled } from "../wallet/client.js";

export const walletRouter: Router = Router();

interface CardRow extends RowDataPacket {
  id: string;
  google_wallet_object_id: string | null;
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
