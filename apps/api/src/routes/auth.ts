import { Router, type Request, type Response } from "express";
import type { RowDataPacket } from "mysql2";
import {
  AuthRequestInput,
  AuthVerifyInput,
  type AuthRequestResult,
  type AuthVerifyResult,
  type Merchant,
  type SessionUser,
} from "@stampdeck/shared";
import { pool } from "../db/pool.js";
import { ApiError } from "../errors.js";
import { env } from "../config.js";
import { issueMagicLink } from "../auth/magic-link.js";
import { signJwt } from "../auth/jwt.js";

export const authRouter: Router = Router();

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
}

interface AuthTokenRow extends RowDataPacket {
  token: string;
  user_id: string;
  expires_at: Date;
  used: number;
}

authRouter.post("/request", async (req: Request, res: Response<AuthRequestResult>) => {
  const { email } = AuthRequestInput.parse(req.body);

  const [rows] = await pool.execute<StaffUserRow[]>(
    "SELECT id FROM staff_users WHERE email = ? LIMIT 1",
    [email]
  );
  // We respond OK either way so the endpoint cannot be used to enumerate accounts.
  // The link is only issued when the user actually exists.
  if (rows.length === 0) {
    return res.json({ ok: true });
  }

  const { url } = await issueMagicLink(rows[0].id);
  const result: AuthRequestResult = { ok: true };
  if (env.NODE_ENV !== "production") result.devMagicLink = url;
  return res.json(result);
});

authRouter.post("/verify", async (req: Request, res: Response<AuthVerifyResult>) => {
  const { token } = AuthVerifyInput.parse(req.body);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [tokenRows] = await conn.execute<AuthTokenRow[]>(
      "SELECT token, user_id, expires_at, used FROM auth_tokens WHERE token = ? LIMIT 1",
      [token]
    );
    if (tokenRows.length === 0) throw ApiError.unauthorized("invalid token");
    const row = tokenRows[0];
    if (row.used) throw ApiError.unauthorized("token already used");
    if (new Date(row.expires_at).getTime() < Date.now()) {
      throw ApiError.unauthorized("token expired");
    }

    await conn.execute("UPDATE auth_tokens SET used = TRUE WHERE token = ?", [token]);

    const [userRows] = await conn.execute<StaffUserRow[]>(
      "SELECT id, merchant_id, email, name, role FROM staff_users WHERE id = ? LIMIT 1",
      [row.user_id]
    );
    if (userRows.length === 0) throw ApiError.unauthorized("user not found");
    const u = userRows[0];

    const [merchantRows] = await conn.execute<MerchantRow[]>(
      "SELECT id, business_name, owner_email, country, status FROM merchants WHERE id = ? LIMIT 1",
      [u.merchant_id]
    );
    if (merchantRows.length === 0) throw ApiError.unauthorized("merchant not found");
    const m = merchantRows[0];

    await conn.commit();

    const user: SessionUser = {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      merchantId: u.merchant_id,
    };
    const merchant: Merchant = {
      id: m.id,
      businessName: m.business_name,
      ownerEmail: m.owner_email,
      country: m.country,
      status: m.status,
    };
    const jwt = signJwt({ userId: u.id, merchantId: m.id, role: u.role });

    return res.json({ jwt, user, merchant });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});
