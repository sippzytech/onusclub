import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import {
  AuthRequestInput,
  AuthVerifyInput,
  ForgotPasswordInput,
  GoogleAuthInput,
  PasswordLoginInput,
  PasswordSignupInput,
  ResetPasswordInput,
  type AuthRequestResult,
  type AuthVerifyResult,
  type ForgotPasswordResult,
  type GoogleAuthResult,
  type Merchant,
  type PasswordAuthResult,
  type SessionUser,
} from "@onusclub/shared";
import { pool } from "../db/pool.js";
import { ApiError } from "../errors.js";
import { env } from "../config.js";
import { issueMagicLink } from "../auth/magic-link.js";
import { signJwt } from "../auth/jwt.js";
import { requireGoogleConfigured, verifyGoogleIdToken } from "../auth/google.js";
// Rate limits on the endpoints where the absence actually mattered: unlimited
// password guesses, and unlimited outbound email on a shared quota.
import {
  loginLimiter,
  passwordResetLimiter,
  signupLimiter,
} from "../http/rate-limit.js";
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
  signupLimiter,
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

      // TRIAL_DAYS_DEFAULT of 0 means trials are switched off: create the
      // merchant with no clock rather than one that expires immediately.
      await conn.execute<ResultSetHeader>(
        `INSERT INTO merchants
           (id, business_name, owner_email, country, status, public_slug, trial_ends_at)
         VALUES (?, ?, ?, 'NL', 'trial', ?, ${
           env.TRIAL_DAYS_DEFAULT > 0
             ? `DATE_ADD(NOW(), INTERVAL ${env.TRIAL_DAYS_DEFAULT} DAY)`
             : "NULL"
         })`,
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
        kind: "welcome",
        merchantId,
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
  loginLimiter,
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

// ---------------------------------------------------------------------------
// POST /v1/auth/google — one endpoint for both login and signup (Day 29)
//
// Login and signup are the same request here because, from a verified Google
// identity, the only difference is whether a row already exists. Splitting
// them would mean two endpoints doing the same lookup and disagreeing about
// the account-linking rule.
//
// Rate-limited with loginLimiter: this is a sign-in endpoint and the account
// creation it can perform is the same thing /signup does. Keyed on address
// plus the submitted email there; here the body has no email (it is inside the
// token), so the key falls back to "?" and becomes address-only — which is the
// right shape for a path where credential-stuffing is not possible anyway.
// ---------------------------------------------------------------------------

interface GoogleUserRow extends RowDataPacket {
  id: string;
  merchant_id: string;
  email: string;
  name: string | null;
  role: "owner" | "staff";
  google_sub: string | null;
}

authRouter.post(
  "/google",
  loginLimiter,
  async (req: Request, res: Response<GoogleAuthResult>) => {
    // ⚠️ Validate BEFORE the configured check, so a client sending no token
    // gets 400 rather than 503. The other order makes a client bug read as
    // "the feature is switched off", which sends the wrong person looking in
    // the wrong place. Same ordering as the AI drafts endpoint.
    const input = GoogleAuthInput.parse(req.body);
    requireGoogleConfigured();

    // Nothing below reads the request body for identity. Everything comes from
    // the verified token.
    const identity = await verifyGoogleIdToken(input.idToken);

    // Match on `google_sub` FIRST, then the verified email.
    //
    // sub is immutable; a Google account can change its email address, and a
    // Workspace admin can rename one. Matching email-first would turn such a
    // change into "no account found" and invite the owner to create a second
    // café — while the sub we already stored was sitting right there.
    //
    // The email fallback is what lets an owner who signed up with a password
    // start using the Google button on that same account.
    const [users] = await pool.execute<GoogleUserRow[]>(
      `SELECT id, merchant_id, email, name, role, google_sub
         FROM staff_users
        WHERE google_sub = ? OR email = ?
        ORDER BY google_sub IS NULL
        LIMIT 1`,
      [identity.sub, identity.email]
    );

    if (users.length > 0) {
      const u = users[0];

      // First time this account has been used with Google: record the sub so
      // every later sign-in matches on it rather than the mutable email.
      //
      // ⚠️ This is the account-linking step, and it is safe ONLY because
      // verifyGoogleIdToken refused to return an unverified email. Without
      // that check, anyone able to set any address on a Google account could
      // take over the matching OnUsClub account.
      if (u.google_sub === null) {
        await pool.execute("UPDATE staff_users SET google_sub = ? WHERE id = ?", [
          identity.sub,
          u.id,
        ]);
        logger.info(
          { userId: u.id, merchantId: u.merchant_id },
          "linked an existing account to a Google identity"
        );
      }

      const [merchants] = await pool.execute<MerchantWithSlugRow[]>(
        `SELECT id, business_name, owner_email, country, status, public_slug
           FROM merchants WHERE id = ? LIMIT 1`,
        [u.merchant_id]
      );
      if (merchants.length === 0) throw ApiError.unauthorized("merchant not found");
      const m = merchants[0];

      return res.json({
        status: "authenticated",
        jwt: signJwt({ userId: u.id, merchantId: m.id, role: u.role }),
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

    // No account. Google told us who the person is but not what their café is
    // called, and a merchant row cannot be created without a name to generate
    // the public slug from. So: ask, and let them resend the same token.
    if (!input.businessName) {
      return res.json({
        status: "needs_business_name",
        email: identity.email,
        name: identity.name,
      });
    }

    // ---- Create the café. Mirrors POST /signup, minus the password. ----
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Re-checked inside the transaction rather than trusting the SELECT
      // above: two taps on a slow connection are two requests, and without
      // this the second one creates a duplicate café. The password signup
      // guards the same way.
      const [existingMerchant] = await conn.execute<CountRow[]>(
        "SELECT COUNT(*) AS c FROM merchants WHERE owner_email = ?",
        [identity.email]
      );
      if (existingMerchant[0].c > 0) {
        throw ApiError.conflict("a merchant with this owner email already exists");
      }

      const merchantId = randomUUID();
      const userId = randomUUID();
      const publicSlug = await generateUniqueSlug(input.businessName);

      await conn.execute<ResultSetHeader>(
        `INSERT INTO merchants
           (id, business_name, owner_email, country, status, public_slug, trial_ends_at)
         VALUES (?, ?, ?, 'NL', 'trial', ?, ${
           env.TRIAL_DAYS_DEFAULT > 0
             ? `DATE_ADD(NOW(), INTERVAL ${env.TRIAL_DAYS_DEFAULT} DAY)`
             : "NULL"
         })`,
        [merchantId, input.businessName, identity.email, publicSlug]
      );

      // password_hash stays NULL, and that already works: /login checks for it
      // and returns the same "invalid email or password" as a wrong password,
      // deliberately not revealing which. If this owner later wants a password
      // too, forgot-password sets one — the two doors then coexist on one
      // account rather than being mutually exclusive.
      await conn.execute<ResultSetHeader>(
        `INSERT INTO staff_users
           (id, merchant_id, email, name, role, google_sub)
         VALUES (?, ?, ?, ?, 'owner', ?)`,
        [userId, merchantId, identity.email, identity.name, identity.sub]
      );

      await conn.commit();

      // Same best-effort welcome email as the password path. A café that signs
      // up with Google should not silently miss its own QR link.
      void sendEmail({
        kind: "welcome",
        merchantId,
        to: identity.email,
        subject: `Welcome to OnUsClub, ${input.businessName}`,
        text:
          `Hi ${identity.name ?? "there"},\n\n` +
          `Your OnUsClub account for ${input.businessName} is ready.\n\n` +
          `Sign in with Google: ${env.BASE_URL_WEB}/login\n\n` +
          `Your public signup link for customers (use it as a QR code on your counter):\n` +
          `${env.BASE_URL_WEB}/m/${publicSlug}\n\n` +
          `— OnUsClub`,
        html:
          `<p>Hi ${identity.name ?? "there"},</p>` +
          `<p>Your OnUsClub account for <strong>${input.businessName}</strong> is ready.</p>` +
          `<p><a href="${env.BASE_URL_WEB}/login">Sign in with Google</a></p>` +
          `<p>Your public signup link for customers:<br>` +
          `<a href="${env.BASE_URL_WEB}/m/${publicSlug}">${env.BASE_URL_WEB}/m/${publicSlug}</a></p>` +
          `<p>— OnUsClub</p>`,
      }).catch((err: unknown) =>
        logger.warn({ err, ownerEmail: identity.email }, "welcome email failed")
      );

      return res.status(201).json({
        status: "authenticated",
        jwt: signJwt({ userId, merchantId, role: "owner" }),
        user: {
          id: userId,
          email: identity.email,
          name: identity.name,
          role: "owner",
          merchantId,
        },
        merchant: {
          id: merchantId,
          businessName: input.businessName,
          ownerEmail: identity.email,
          country: "NL",
          status: "trial",
        },
        publicSlug,
      });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }
);

authRouter.post("/request", passwordResetLimiter, async (req: Request, res: Response<AuthRequestResult>) => {
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
  // Carried so the recorded send is attributable to a café. Someone locked out
  // of their account cannot look this up themselves — we have to.
  merchant_id: string;
}

authRouter.post(
  "/forgot-password",
  passwordResetLimiter,
  async (req: Request, res: Response<ForgotPasswordResult>) => {
    const { email } = ForgotPasswordInput.parse(req.body);

    const [rows] = await pool.execute<UserIdRow[]>(
      "SELECT id, merchant_id FROM staff_users WHERE email = ? LIMIT 1",
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
      kind: "password_reset",
      merchantId: rows[0].merchant_id,
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
