import { Router, type Request, type Response } from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import {
  MerchantBrandingInput,
  MerchantPreferencesInput,
  type Merchant,
  type MerchantPreferences,
  type SessionUser,
  type MerchantBranding as MerchantBrandingResponse,
  type TrialStatus,
} from "@onusclub/shared";
import { pool } from "../db/pool.js";
import { authContext, requireAuth } from "../auth/middleware.js";
import { ApiError } from "../errors.js";
import { env } from "../config.js";
import { inspectImage } from "../merchants/image.js";
import { isPlatformAdmin } from "../admin/authorize.js";

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
  trial_ends_at: Date | null;
  brand_color: string | null;
  logo_url: string | null;
}

/**
 * Derive trial state from the stored expiry. Nothing about "how long is left"
 * is persisted, so it cannot drift out of step with the date it came from.
 *
 * daysLeft floors, so the final day reads 0 and the banner can say "ends
 * today" rather than overstating it as "1 day left". Ceil would never produce
 * 0 for a live trial, leaving that state unreachable. Expired is strictly
 * "the timestamp is in the past".
 */
export function deriveTrial(endsAt: Date | null): TrialStatus {
  if (!endsAt) return { endsAt: null, daysLeft: null, expired: false };
  const ms = endsAt.getTime() - Date.now();
  return {
    endsAt: endsAt.toISOString(),
    daysLeft: Math.max(0, Math.floor(ms / 86_400_000)),
    expired: ms <= 0,
  };
}

export interface MeResponse {
  trial: TrialStatus;
  user: SessionUser;
  merchant: Merchant;
  publicSlug: string;
  preferences: MerchantPreferences;
  /**
   * Whether to show the platform-admin link in the dashboard. Advisory UI
   * only — the gate is `requirePlatformAdmin` on the /v1/admin mount, and
   * nothing trusts this flag for access. False for every café, always.
   */
  isPlatformAdmin: boolean;
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
            is_premium, crons_enabled, trial_ends_at
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
    trial: deriveTrial(m.trial_ends_at),
    isPlatformAdmin: await isPlatformAdmin(ctx.userId),
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

// ---------------------------------------------------------------------------
// Merchant branding: logo + brand colour.
//
// Until now `merchants.brand_color`, `logo_url` and `hero_url` existed in the
// schema with no write path anywhere — brand_color sat permanently at its
// migration default of '#000000' while feeding the middle tier of every card
// and pass colour, and every Google Wallet pass showed the OnUsClub badge as
// the merchant's own logo. This is that write path.
// ---------------------------------------------------------------------------

interface AssetVersionRow extends RowDataPacket {
  version: string;
}

/** Public URL of a merchant's stored logo, cache-busted by content hash. */
function logoUrlFor(merchantId: string, version: string): string {
  const base = env.BASE_URL_API.replace(/\/$/, "");
  return `${base}/v1/public/m/${merchantId}/logo.png?v=${version}`;
}

meRouter.get(
  "/branding",
  requireAuth,
  async (req: Request, res: Response<MerchantBrandingResponse>) => {
    const ctx = authContext(req);
    const [rows] = await pool.execute<MerchantRow[]>(
      "SELECT brand_color, logo_url FROM merchants WHERE id = ? LIMIT 1",
      [ctx.merchantId]
    );
    return res.json({
      brandColor: rows[0]?.brand_color ?? null,
      logoUrl: rows[0]?.logo_url ?? null,
    });
  }
);

meRouter.patch(
  "/branding",
  requireAuth,
  async (req: Request, res: Response<MerchantBrandingResponse>) => {
    const ctx = authContext(req);
    const input = MerchantBrandingInput.parse(req.body);

    if (input.logoBase64 !== undefined) {
      if (input.logoBase64 === null) {
        await pool.execute("DELETE FROM merchant_assets WHERE merchant_id = ? AND kind = 'logo'", [
          ctx.merchantId,
        ]);
        await pool.execute("UPDATE merchants SET logo_url = NULL WHERE id = ?", [ctx.merchantId]);
      } else {
        const buf = Buffer.from(input.logoBase64, "base64");
        // Inspected from the file's own header, not the browser's claim about
        // it: a mislabelled file would be handed to Google and Apple as
        // something it is not.
        const checked = inspectImage(buf);
        if (!checked.ok) throw ApiError.badRequest(checked.reason);

        await pool.execute<ResultSetHeader>(
          `INSERT INTO merchant_assets (merchant_id, kind, content_type, bytes, version)
           VALUES (?, 'logo', ?, ?, ?)
           ON DUPLICATE KEY UPDATE content_type = VALUES(content_type),
                                   bytes = VALUES(bytes),
                                   version = VALUES(version)`,
          [ctx.merchantId, checked.info.contentType, buf, checked.version]
        );
        await pool.execute("UPDATE merchants SET logo_url = ? WHERE id = ?", [
          logoUrlFor(ctx.merchantId, checked.version),
          ctx.merchantId,
        ]);
      }
    }

    if (input.brandColor !== undefined) {
      await pool.execute("UPDATE merchants SET brand_color = ? WHERE id = ?", [
        input.brandColor,
        ctx.merchantId,
      ]);
    }

    const [rows] = await pool.execute<MerchantRow[]>(
      "SELECT brand_color, logo_url FROM merchants WHERE id = ? LIMIT 1",
      [ctx.merchantId]
    );
    return res.json({
      brandColor: rows[0]?.brand_color ?? null,
      logoUrl: rows[0]?.logo_url ?? null,
    });
  }
);
