import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import {
  MerchantSignupInput,
  type MerchantSignupResult,
  type Merchant,
  type SessionUser,
} from "@onusclub/shared";
import { pool } from "../db/pool.js";
import { env } from "../config.js";
import { ApiError } from "../errors.js";

import { signupLimiter } from "../http/rate-limit.js";

export const merchantsRouter: Router = Router();

interface CountRow extends RowDataPacket {
  c: number;
}

merchantsRouter.post("/", signupLimiter, async (req: Request, res: Response<MerchantSignupResult>) => {
  const input = MerchantSignupInput.parse(req.body);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [existingMerchant] = await conn.execute<CountRow[]>(
      "SELECT COUNT(*) AS c FROM merchants WHERE owner_email = ?",
      [input.ownerEmail]
    );
    if (existingMerchant[0].c > 0) {
      throw ApiError.conflict("a merchant with this owner email already exists");
    }
    const [existingUser] = await conn.execute<CountRow[]>(
      "SELECT COUNT(*) AS c FROM staff_users WHERE email = ?",
      [input.ownerEmail]
    );
    if (existingUser[0].c > 0) {
      throw ApiError.conflict("a user with this email already exists");
    }

    const merchantId = randomUUID();
    const userId = randomUUID();

    await conn.execute<ResultSetHeader>(
      `INSERT INTO merchants (id, business_name, owner_email, country, status, trial_ends_at)
       VALUES (?, ?, ?, 'NL', 'trial', ${
         env.TRIAL_DAYS_DEFAULT > 0
           ? `DATE_ADD(NOW(), INTERVAL ${env.TRIAL_DAYS_DEFAULT} DAY)`
           : "NULL"
       })`,
      [merchantId, input.businessName, input.ownerEmail]
    );

    await conn.execute<ResultSetHeader>(
      `INSERT INTO staff_users (id, merchant_id, email, name, role)
       VALUES (?, ?, ?, ?, 'owner')`,
      [userId, merchantId, input.ownerEmail, input.ownerName ?? null]
    );

    await conn.commit();

    const merchant: Merchant = {
      id: merchantId,
      businessName: input.businessName,
      ownerEmail: input.ownerEmail,
      country: "NL",
      status: "trial",
    };
    const user: SessionUser = {
      id: userId,
      email: input.ownerEmail,
      name: input.ownerName ?? null,
      role: "owner",
      merchantId,
    };
    return res.status(201).json({ merchant, user });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});
