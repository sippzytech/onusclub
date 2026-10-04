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
  CardDesignInput,
  type CardDesign,
  PublicEnrolInput,
  type PointsCardState,
  type PublicCardView,
  type PublicEnrolResult,
  type PublicMerchant,
  type StampCardState,
} from "@onusclub/shared";
import type {
  AppleCardForWallet,
  AppleProgramForWallet,
} from "../wallet-apple/state.js";
import { pool } from "../db/pool.js";
import { env } from "../config.js";
import { ApiError } from "../errors.js";
import { syncCardToWallet } from "../cards/operations.js";
import { buildSaveJwt, saveUrl } from "../wallet/loyalty.js";
import { buildHeroPng } from "../card-art/raster.js";
import { objectOnCurrentIssuer } from "../wallet/state.js";
import { loadMerchantLocations } from "../merchants/locations.js";

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
  program_type: "stamp" | "points";
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
      `SELECT id, name, program_type, config_json, reward_text
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
      `SELECT id, name, program_type, config_json, reward_text
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
        const initialState =
          programs[0].program_type === "points"
            ? {
                type: "points" as const,
                points_current: 0,
                total_lifetime: 0,
                rewards_redeemed: 0,
                total_expired: 0,
              }
            : {
                type: "stamp" as const,
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

// GET /v1/public/c/:qrToken — customer's own card view. No auth: the qr_token
// itself is the access credential (32 bytes of crypto-random hex). Returns
// sanitised data only — no events, no other customers, no merchant secrets.
interface CardViewRow extends RowDataPacket {
  card_id: string;
  qr_token: string;
  card_state: unknown;
  google_wallet_object_id: string | null;
  status: "active" | "blocked" | "expired";
  business_name: string;
  brand_color: string | null;
  customer_name: string | null;
  program_name: string;
  program_type: "stamp" | "points";
  reward_text: string;
  program_config: unknown;
}

publicRouter.get(
  "/c/:qrToken",
  async (req: Request, res: Response<PublicCardView>) => {
    const qrToken = req.params.qrToken;
    if (!/^[0-9a-f]{64}$/i.test(qrToken)) {
      throw ApiError.notFound("card not found");
    }
    const [rows] = await pool.execute<CardViewRow[]>(
      `SELECT c.id AS card_id, c.qr_token, c.card_state,
              c.google_wallet_object_id, c.status,
              m.business_name, m.brand_color,
              cu.name AS customer_name,
              p.name AS program_name, p.program_type,
              p.reward_text, p.config_json AS program_config
         FROM loyalty_cards c
         JOIN merchants m ON m.id = c.merchant_id
         JOIN customers cu ON cu.id = c.customer_id
         JOIN loyalty_programs p ON p.id = c.program_id
        WHERE c.qr_token = ? LIMIT 1`,
      [qrToken]
    );
    if (rows.length === 0) throw ApiError.notFound("card not found");
    const row = rows[0];
    const cfgRaw =
      typeof row.program_config === "string"
        ? (JSON.parse(row.program_config) as Record<string, unknown>)
        : (row.program_config as Record<string, unknown>);

    let currentValue: number;
    let targetValue: number;
    let unitLabel: "stamps" | "points";
    let rewardsRedeemed: number;
    if (row.program_type === "points") {
      const state =
        typeof row.card_state === "string"
          ? (JSON.parse(row.card_state) as PointsCardState)
          : (row.card_state as PointsCardState);
      currentValue = state.points_current;
      targetValue = Number(cfgRaw.points_for_reward ?? 0);
      unitLabel = "points";
      rewardsRedeemed = state.rewards_redeemed;
    } else {
      const state =
        typeof row.card_state === "string"
          ? (JSON.parse(row.card_state) as StampCardState)
          : (row.card_state as StampCardState);
      currentValue = state.stamps_current;
      targetValue = Number(cfgRaw.stamps_required ?? 0);
      unitLabel = "stamps";
      rewardsRedeemed = state.rewards_redeemed;
    }

    // Issue a fresh save URL only if the wallet object exists ON THE CURRENT
    // ISSUER. A stored id from a previous issuer is still non-null but no
    // longer resolves, so a plain truthiness check would hand a customer an
    // "Add to Google Wallet" button that opens to nothing. The object is
    // recreated on the card's next stamp, and the button reappears then.
    let walletSaveUrl: string | null = null;
    if (objectOnCurrentIssuer(row.google_wallet_object_id)) {
      const token = await buildSaveJwt(row.card_id);
      if (token) walletSaveUrl = saveUrl(token);
    }

    return res.json({
      businessName: row.business_name,
      brandColor: row.brand_color,
      customerName: row.customer_name,
      programName: row.program_name,
      programType: row.program_type,
      rewardText: row.reward_text,
      currentValue,
      targetValue,
      unitLabel,
      // Legacy aliases kept populated for any pre-Day-14 callers.
      stampsCurrent: currentValue,
      stampsRequired: targetValue,
      rewardsRedeemed,
      status: row.status,
      walletSaveUrl,
      // Whatever the merchant saved in the card builder. Parsed leniently:
      // a malformed design must not break a customer's card page, so an
      // invalid blob degrades to null and the renderer uses its defaults.
      design: CardDesignInput.safeParse(cfgRaw.design ?? {}).data ?? null,
    });
  }
);

// GET /v1/public/m/:merchantId/logo.png — the merchant's uploaded logo.
//
// Public because it has to be: Google fetches programLogo server-side when the
// LoyaltyClass is written, and Apple pulls pass assets the same way. Neither
// can present a session. The merchant id is not a secret — it already appears
// in every class and object id.
//
// ?v= is ignored here. It carries the content hash so the URL changes when the
// image does, which is the only way Google will refetch a logo it has already
// cached. Same mechanism as the wallet hero.
interface LogoRow extends RowDataPacket {
  content_type: string;
  bytes: Buffer;
}

publicRouter.get("/m/:merchantId/logo.png", async (req: Request, res: Response) => {
  const merchantId = req.params.merchantId;
  if (!/^[0-9a-f-]{36}$/i.test(merchantId)) throw ApiError.notFound("not found");

  const [rows] = await pool.execute<LogoRow[]>(
    "SELECT content_type, bytes FROM merchant_assets WHERE merchant_id = ? AND kind = 'logo' LIMIT 1",
    [merchantId]
  );
  if (rows.length === 0) throw ApiError.notFound("not found");

  res.setHeader("Content-Type", rows[0].content_type);
  // Immutable: the ?v= hash changes whenever the bytes do, so a given URL
  // genuinely never serves different content.
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  return res.send(rows[0].bytes);
});

// GET /v1/public/c/:qrToken/hero.png — the stamp grid as a PNG, for Google
// Wallet's heroImage.
//
// Apple takes the artwork embedded in the .pkpass bundle. Google does not: the
// LoyaltyObject carries a URI and Google fetches it server-side, so the image
// has to be reachable publicly. Same access model as the rest of /c/:qrToken —
// the 64-char qr_token is the credential.
//
// The ?v= parameter is ignored here on purpose. It exists so the URI changes
// whenever the picture does, because Google caches hero images by URI and will
// not refetch one it has already seen. Rendering is driven by the card's
// current state either way, so the token only needs to vary, not to be read.
interface HeroCardRow extends RowDataPacket {
  card_state: unknown;
  status: "active" | "blocked" | "expired";
  program_type: "stamp" | "points";
  program_config: unknown;
  design: unknown;
}

publicRouter.get("/c/:qrToken/hero.png", async (req: Request, res: Response) => {
  const qrToken = req.params.qrToken;
  if (!/^[0-9a-f]{64}$/i.test(qrToken)) {
    throw ApiError.notFound("card not found");
  }

  const [rows] = await pool.execute<HeroCardRow[]>(
    `SELECT c.card_state, c.status, p.program_type, p.config_json AS program_config,
            JSON_EXTRACT(p.config_json, '$.design') AS design
       FROM loyalty_cards c
       JOIN loyalty_programs p ON p.id = c.program_id
      WHERE c.qr_token = ? LIMIT 1`,
    [qrToken]
  );
  if (rows.length === 0) throw ApiError.notFound("card not found");
  const row = rows[0];

  // Stamp programs only, mirroring the Apple strip. A grid of 420/1000 would
  // be nonsense, and the upper bound stops a mis-configured 500-stamp program
  // emitting a wall of badges.
  if (row.program_type !== "stamp") throw ApiError.notFound("no artwork for this card");

  const state = parseJson<{ type?: string; stamps_current?: number }>(row.card_state);
  const cfg = parseJson<{ stamps_required?: number }>(row.program_config);
  const total = cfg.stamps_required ?? 0;
  const current = state.stamps_current ?? 0;
  if (total <= 0 || total > 30) throw ApiError.notFound("no artwork for this card");

  const design = parseJson<Partial<CardDesign> | null>(row.design);
  const png = buildHeroPng(design, current, total);
  if (!png) throw ApiError.notFound("artwork unavailable");

  res.setHeader("Content-Type", "image/png");
  // Immutable: the ?v= token changes whenever the image does, so any given URL
  // genuinely never changes content. Lets Google and any CDN cache hard.
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  return res.send(png);
});

// GET /v1/public/c/:qrToken/apple-pass — returns a signed .pkpass for iOS
// Wallet. Same access model as /v1/public/c/:qrToken (the 64-char qr_token
// is the credential). iOS Safari opening this URL prompts to save the pass.
interface AppleCardRow extends RowDataPacket {
  card_id: string;
  qr_token: string;
  apple_auth_token: string | null;
  card_state: unknown;
  status: "active" | "blocked" | "expired";
  merchant_id: string;
  business_name: string;
  brand_color: string | null;
  customer_name: string | null;
  program_id: string;
  program_name: string;
  program_type: "stamp" | "points";
  reward_text: string;
  program_config: unknown;
}

publicRouter.get("/c/:qrToken/apple-pass", async (req: Request, res: Response) => {
  const qrToken = req.params.qrToken;
  if (!/^[0-9a-f]{64}$/i.test(qrToken)) {
    throw ApiError.notFound("card not found");
  }

  const [rows] = await pool.execute<AppleCardRow[]>(
    `SELECT c.id AS card_id, c.qr_token, c.apple_auth_token, c.card_state, c.status,
            m.id AS merchant_id, m.business_name, m.brand_color,
            cu.name AS customer_name,
            p.id AS program_id, p.name AS program_name, p.program_type,
            p.reward_text, p.config_json AS program_config
       FROM loyalty_cards c
       JOIN merchants m ON m.id = c.merchant_id
       JOIN customers cu ON cu.id = c.customer_id
       JOIN loyalty_programs p ON p.id = c.program_id
      WHERE c.qr_token = ? LIMIT 1`,
    [qrToken]
  );
  if (rows.length === 0) throw ApiError.notFound("card not found");
  const row = rows[0];
  if (row.status !== "active") {
    throw ApiError.badRequest("card is not active");
  }

  // Lazy-generate per-card Apple Wallet auth token. Stable across downloads
  // (a re-add of the same pass must keep the same authenticationToken or
  // Wallet's web-service calls won't match).
  let appleAuthToken = row.apple_auth_token;
  if (!appleAuthToken) {
    appleAuthToken = randomBytes(32).toString("hex");
    await pool.execute(
      "UPDATE loyalty_cards SET apple_auth_token = ? WHERE id = ?",
      [appleAuthToken, row.card_id]
    );
  }

  const cfgRaw =
    typeof row.program_config === "string"
      ? (JSON.parse(row.program_config) as Record<string, unknown>)
      : (row.program_config as Record<string, unknown>);

  let programForApple: AppleProgramForWallet;
  let cardForApple: AppleCardForWallet;
  if (row.program_type === "points") {
    const state =
      typeof row.card_state === "string"
        ? (JSON.parse(row.card_state) as PointsCardState)
        : (row.card_state as PointsCardState);
    programForApple = {
      programType: "points",
      id: row.program_id,
      name: row.program_name,
      rewardText: row.reward_text,
      pointsForReward: Number(cfgRaw.points_for_reward ?? 0),
      design: CardDesignInput.safeParse(cfgRaw.design ?? {}).data ?? null,
    };
    cardForApple = {
      id: row.card_id,
      qrToken: row.qr_token,
      state,
      customerName: row.customer_name,
    };
  } else {
    const state =
      typeof row.card_state === "string"
        ? (JSON.parse(row.card_state) as StampCardState)
        : (row.card_state as StampCardState);
    programForApple = {
      programType: "stamp",
      id: row.program_id,
      name: row.program_name,
      rewardText: row.reward_text,
      stampsRequired: Number(cfgRaw.stamps_required ?? 0),
      design: CardDesignInput.safeParse(cfgRaw.design ?? {}).data ?? null,
    };
    cardForApple = {
      id: row.card_id,
      qrToken: row.qr_token,
      state,
      customerName: row.customer_name,
    };
  }

  // Lazy import — avoids loading passkit-generator at module-init time when
  // the api is doing other unrelated work (and keeps the cold-start lean).
  const { buildPkPass } = await import("../wallet-apple/pass-builder.js");
  const pkPassBuffer = await buildPkPass(
    {
      id: row.merchant_id,
      businessName: row.business_name,
      brandColor: row.brand_color,
      // Shared loader, not an inline query — the other buildPkPass call site
      // in routes/apple-wallet.ts must assemble this identically.
      locations: await loadMerchantLocations(row.merchant_id),
    },
    programForApple,
    cardForApple,
    // iOS Wallet rejects any pass whose webServiceURL isn't HTTPS — and the
    // device must be able to reach the host. localhost / plain HTTP would
    // make Safari refuse to open the pass entirely. So we only opt-in to
    // live updates when BASE_URL_API is HTTPS; otherwise emit a static
    // pass (Day 11 behavior) and the customer still gets a working pass,
    // just without auto-refresh.
    env.BASE_URL_API.startsWith("https://")
      ? {
          webServiceURL: `${env.BASE_URL_API.replace(/\/$/, "")}/v1/apple-wallet`,
          authenticationToken: appleAuthToken,
        }
      : undefined
  );

  if (!pkPassBuffer) {
    throw new ApiError(
      503,
      "apple_wallet_unavailable",
      "Apple Wallet is not configured on this server"
    );
  }

  res.setHeader("Content-Type", "application/vnd.apple.pkpass");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="onusclub-${row.card_id}.pkpass"`
  );
  // Disable cache so an updated pass isn't served stale by the customer's
  // browser if they re-tap the link after a stamp.
  res.setHeader("Cache-Control", "no-store");
  res.send(pkPassBuffer);
});
