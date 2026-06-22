import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import {
  AuthRequestInput,
  AuthVerifyInput,
  ForgotPasswordInput,
  PasswordLoginInput,
  PasswordSignupInput,
  ResetPasswordInput,
  type AuthRequestResult,
  type AuthVerifyResult,
  type ForgotPasswordResult,
  type Merchant,
  type PasswordAuthResult,
  type SessionUser,
} from "@onusclub/shared";
import { pool } from "../db/pool.js";
import { ApiError } from "../errors.js";
import { env } from "../config.js";
import { issueMagicLink } from "../auth/magic-link.js";
import { signJwt } from "../auth/jwt.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { generateUniqueSlug } from "../auth/slug.js";
import { logger } from "../logger.js";
import { sendEmail } from "../email/client.js";

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

interface MerchantWithSlugRow extends RowDataPacket {
  id: string;
  business_name: string;
  owner_email: string;
  country: string;
  status: "active" | "suspended" | "trial";
  public_slug: string | null;
}

interface UserWithPasswordRow extends RowDataPacket {
  id: string;
  merchant_id: string;
  email: string;
  name: string | null;
  role: "owner" | "staff";
  password_hash: Buffer | null;
}

interface CountRow extends RowDataPacket {
  c: number;
}

// ---------- Password signup (preferred owner signup path) ----------

authRouter.post(
  "/signup",
  async (req: Request, res: Response<PasswordAuthResult>) => {
    const input = PasswordSignupInput.parse(req.body);

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
      const passwordHash = await hashPassword(input.password);
      const publicSlug = await generateUniqueSlug(input.businessName);

      await conn.execute<ResultSetHeader>(
        `INSERT INTO merchants
           (id, business_name, owner_email, country, status, public_slug)
         VALUES (?, ?, ?, 'NL', 'trial', ?)`,
        [merchantId, input.businessName, input.ownerEmail, publicSlug]
      );

      await conn.execute<ResultSetHeader>(
        `INSERT INTO staff_users
           (id, merchant_id, email, name, role, password_hash)
         VALUES (?, ?, ?, ?, 'owner', ?)`,
        [
          userId,
          merchantId,
          input.ownerEmail,
          input.ownerName ?? null,
          Buffer.from(passwordHash, "utf8"),
        ]
      );

      await conn.commit();

      const user: SessionUser = {
        id: userId,
        email: input.ownerEmail,
        name: input.ownerName ?? null,
        role: "owner",
        merchantId,
      };
      const merchant: Merchant = {
        id: merchantId,
        businessName: input.businessName,
        ownerEmail: input.ownerEmail,
        country: "NL",
        status: "trial",
      };
      const jwt = signJwt({ userId, merchantId, role: "owner" });

      // Best-effort welcome email. Failure does not block signup.
      void sendEmail({
        to: input.ownerEmail,
        subject: `Welcome to OnUsClub, ${input.businessName}`,
        text:
          `Hi ${input.ownerName ?? "there"},\n\n` +
          `Your OnUsClub account for ${input.businessName} is ready.\n\n` +
          `Sign in: ${env.BASE_URL_WEB}/login\n\n` +
          `Your public signup link for customers (use it as a QR code on your counter):\n` +
          `${env.BASE_URL_WEB}/m/${publicSlug}\n\n` +
          `— OnUsClub`,
        html:
          `<p>Hi ${input.ownerName ?? "there"},</p>` +
          `<p>Your OnUsClub account for <strong>${input.businessName}</strong> is ready.</p>` +
          `<p><a href="${env.BASE_URL_WEB}/login">Sign in</a></p>` +
          `<p>Your public signup link for customers:<br>` +
          `<a href="${env.BASE_URL_WEB}/m/${publicSlug}">${env.BASE_URL_WEB}/m/${publicSlug}</a></p>` +
          `<p>— OnUsClub</p>`,
      }).catch((err: unknown) =>
        logger.warn({ err, ownerEmail: input.ownerEmail }, "welcome email failed")
      );

      return res.status(201).json({ jwt, user, merchant, publicSlug });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }
);

// ---------- Password login ----------

authRouter.post(
  "/login",
  async (req: Request, res: Response<PasswordAuthResult>) => {
    const input = PasswordLoginInput.parse(req.body);

    const [users] = await pool.execute<UserWithPasswordRow[]>(
      `SELECT id, merchant_id, email, name, role, password_hash
         FROM staff_users WHERE email = ? LIMIT 1`,
      [input.email]
    );
    if (users.length === 0) throw ApiError.unauthorized("invalid email or password");
    const u = users[0];
    if (!u.password_hash) {
      // Account exists but was created before passwords were a thing (legacy
      // magic-link only). Don't leak that — same error as wrong password.
      throw ApiError.unauthorized("invalid email or password");
    }
    const hash = u.password_hash.toString("utf8");
    const ok = await verifyPassword(input.password, hash);
    if (!ok) throw ApiError.unauthorized("invalid email or password");

    const [merchants] = await pool.execute<MerchantWithSlugRow[]>(
      `SELECT id, business_name, owner_email, country, status, public_slug
         FROM merchants WHERE id = ? LIMIT 1`,
      [u.merchant_id]
    );
    if (merchants.length === 0) throw ApiError.unauthorized("merchant not found");
    const m = merchants[0];

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

    return res.json({ jwt, user, merchant, publicSlug: m.public_slug ?? "" });
  }
);

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

// ---------- Forgot password ----------

interface UserIdRow extends RowDataPacket {
  id: string;
}

authRouter.post(
  "/forgot-password",
  async (req: Request, res: Response<ForgotPasswordResult>) => {
    const { email } = ForgotPasswordInput.parse(req.body);

    const [rows] = await pool.execute<UserIdRow[]>(
      "SELECT id FROM staff_users WHERE email = ? LIMIT 1",
      [email]
    );
    // Respond OK either way so the endpoint can't be used to enumerate
    // accounts. Token is only issued when the user actually exists.
    if (rows.length === 0) return res.json({ ok: true });

    const { url } = await issueMagicLink(rows[0].id);
    // Reset link points at the password-reset page, not the magic-link
    // verify page — they live under different routes on web.
    const resetUrl = url.replace("/auth/verify", "/auth/reset-password");

    // Best-effort email — Resend test mode caveats still apply.
    void sendEmail({
      to: email,
      subject: "Reset your OnUsClub password",
      text:
        `We received a request to reset your OnUsClub password.\n\n` +
        `Click this link to choose a new password:\n${resetUrl}\n\n` +
        `If you didn't request this, ignore this email. The link expires in 1 hour.`,
      html:
        `<p>We received a request to reset your OnUsClub password.</p>` +
        `<p><a href="${resetUrl}">Choose a new password</a></p>` +
        `<p>If you didn't request this, ignore this email. The link expires in 1 hour.</p>`,
    }).catch((err: unknown) => logger.warn({ err, email }, "reset email failed"));

    const result: ForgotPasswordResult = { ok: true };
    if (env.NODE_ENV !== "production") result.devResetLink = resetUrl;
    return res.json(result);
  }
);

authRouter.post(
  "/reset-password",
  async (req: Request, res: Response<PasswordAuthResult>) => {
    const { token, password } = ResetPasswordInput.parse(req.body);

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

      const passwordHash = await hashPassword(password);
      await conn.execute(
        "UPDATE staff_users SET password_hash = ? WHERE id = ?",
        [Buffer.from(passwordHash, "utf8"), row.user_id]
      );

      const [userRows] = await conn.execute<UserWithPasswordRow[]>(
        `SELECT id, merchant_id, email, name, role, password_hash
           FROM staff_users WHERE id = ? LIMIT 1`,
        [row.user_id]
      );
      if (userRows.length === 0) throw ApiError.unauthorized("user not found");
      const u = userRows[0];

      const [merchantRows] = await conn.execute<MerchantWithSlugRow[]>(
        `SELECT id, business_name, owner_email, country, status, public_slug
           FROM merchants WHERE id = ? LIMIT 1`,
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

      return res.json({ jwt, user, merchant, publicSlug: m.public_slug ?? "" });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }
);
