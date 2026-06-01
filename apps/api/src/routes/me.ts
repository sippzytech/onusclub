import { Router, type Request, type Response } from "express";
import type { RowDataPacket } from "mysql2";
import type { Merchant, SessionUser } from "@stampdeck/shared";
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
}

meRouter.get(
  "/",
  requireAuth,
  async (
    req: Request,
    res: Response<{ user: SessionUser; merchant: Merchant; publicSlug: string }>
  ) => {
    const ctx = authContext(req);

    const [userRows] = await pool.execute<StaffUserRow[]>(
      "SELECT id, merchant_id, email, name, role FROM staff_users WHERE id = ? LIMIT 1",
      [ctx.userId]
    );
    if (userRows.length === 0) throw ApiError.unauthorized("user not found");
    const u = userRows[0];

    const [merchantRows] = await pool.execute<MerchantRow[]>(
      "SELECT id, business_name, owner_email, country, status, public_slug FROM merchants WHERE id = ? LIMIT 1",
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
    });
  }
);
