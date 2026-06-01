import { Router, type Request, type Response } from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import {
  MerchantPreferencesInput,
  type Merchant,
  type MerchantPreferences,
  type SessionUser,
} from "@stampdeck/shared";
import { pool } from "../db/pool.js";
import { authContext, requireAuth } from "../auth/middleware.js";
import { ApiError } from "../errors.js";

export const meRouter: Router = Router();

interface StaffUserRow extends RowDataPacket {
  id: string;
  merchant_id: string;
  email: string;
  name: string | null;
  role: "owner" | "staff";
}

interface MerchantRow extends RowDataPacket {
  id: string;
  business_name: string;
  owner_email: string;
  country: string;
  status: "active" | "suspended" | "trial";
  public_slug: string | null;
  is_premium: number;
  crons_enabled: number;
}

export interface MeResponse {
  user: SessionUser;
  merchant: Merchant;
  publicSlug: string;
  preferences: MerchantPreferences;
}

meRouter.get("/", requireAuth, async (req: Request, res: Response<MeResponse>) => {
  const ctx = authContext(req);

  const [userRows] = await pool.execute<StaffUserRow[]>(
    "SELECT id, merchant_id, email, name, role FROM staff_users WHERE id = ? LIMIT 1",
    [ctx.userId]
  );
  if (userRows.length === 0) throw ApiError.unauthorized("user not found");
  const u = userRows[0];

  const [merchantRows] = await pool.execute<MerchantRow[]>(
    `SELECT id, business_name, owner_email, country, status, public_slug,
            is_premium, crons_enabled
       FROM merchants WHERE id = ? LIMIT 1`,
    [ctx.merchantId]
  );
  if (merchantRows.length === 0) throw ApiError.unauthorized("merchant not found");
  const m = merchantRows[0];

  return res.json({
    user: {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      merchantId: u.merchant_id,
    },
    merchant: {
      id: m.id,
      businessName: m.business_name,
      ownerEmail: m.owner_email,
      country: m.country,
      status: m.status,
    },
    publicSlug: m.public_slug ?? "",
    preferences: {
      isPremium: Boolean(m.is_premium),
      cronsEnabled: Boolean(m.crons_enabled),
    },
  });
});

// PATCH /v1/me/preferences — toggles is_premium (fake unlock for now) and the
// crons_enabled kill switch. Owner-scoped.
meRouter.patch(
  "/preferences",
  requireAuth,
  async (req: Request, res: Response<MerchantPreferences>) => {
    const ctx = authContext(req);
    const input = MerchantPreferencesInput.parse(req.body);

    const sets: string[] = [];
    const params: (boolean | string)[] = [];
    if (input.isPremium !== undefined) {
      sets.push("is_premium = ?");
      params.push(input.isPremium);
    }
    if (input.cronsEnabled !== undefined) {
      sets.push("crons_enabled = ?");
      params.push(input.cronsEnabled);
    }
    if (sets.length === 0) {
      throw ApiError.badRequest("no fields to update");
    }
    params.push(ctx.merchantId);
    await pool.execute<ResultSetHeader>(
      `UPDATE merchants SET ${sets.join(", ")} WHERE id = ?`,
      params
    );

    const [rows] = await pool.execute<MerchantRow[]>(
      "SELECT is_premium, crons_enabled FROM merchants WHERE id = ? LIMIT 1",
      [ctx.merchantId]
    );
    const m = rows[0];
    return res.json({
      isPremium: Boolean(m.is_premium),
      cronsEnabled: Boolean(m.crons_enabled),
    });
  }
);
