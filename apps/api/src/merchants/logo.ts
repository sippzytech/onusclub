/**
 * The public URL of a merchant's logo — DERIVED, never stored.
 *
 * WHY THIS FILE EXISTS (Day 30)
 *
 * `merchants.logo_url` used to hold the finished absolute URL, built from
 * `BASE_URL_API` at upload time and then frozen in the database forever. That
 * is a staleness bug with a long fuse: change the api's domain and every logo
 * uploaded before the change points at the old one.
 *
 * It was found when a dev machine's `BASE_URL_API` was an ngrok tunnel used
 * for Apple Wallet testing. The tunnel expired, and the logo on the Settings
 * page became a broken image — pointing at a hostname that no longer existed.
 *
 * 🚨 The production version of that is worse and silent. Google fetches
 * `programLogo` **server-side and caches it by URI**, so a stale URL does not
 * render a broken image on a café's pass — the logo just quietly stops
 * updating, or vanishes, with nothing failing anywhere. The EU VPS migration
 * on the roadmap would have triggered exactly that for every merchant at once,
 * and `resync-wallet-class-logos.ts` would not have saved it: that script read
 * the same frozen column and would have faithfully re-pushed the dead URL.
 *
 * The fix is to stop storing derived data. `merchant_assets.version` is the
 * content hash and the only durable fact; the URL is computed from it on every
 * read, so it always reflects current configuration. Nothing to migrate when a
 * domain changes, and nothing that can drift.
 *
 * The `?v=` token stays, and is load-bearing for the same caching reason: a
 * merchant replacing their logo must change the URI or Google serves the old
 * image indefinitely.
 */
import type { RowDataPacket } from "mysql2";
import { env } from "../config.js";
import { pool } from "../db/pool.js";

/**
 * Build the URL from a content version. Null version means no logo.
 *
 * Pure, so `check:wallet` and friends can assert the shape without a database.
 */
export function logoUrlFromVersion(
  merchantId: string,
  version: string | null | undefined
): string | null {
  if (!version) return null;
  const base = env.BASE_URL_API.replace(/\/$/, "");
  return `${base}/v1/public/m/${merchantId}/logo.png?v=${version}`;
}

interface LogoVersionRow extends RowDataPacket {
  merchant_id: string;
  version: string;
}

/** One merchant's logo URL, or null if they have not uploaded one. */
export async function loadLogoUrl(merchantId: string): Promise<string | null> {
  const [rows] = await pool.execute<LogoVersionRow[]>(
    "SELECT merchant_id, version FROM merchant_assets WHERE merchant_id = ? AND kind = 'logo' LIMIT 1",
    [merchantId]
  );
  return logoUrlFromVersion(merchantId, rows[0]?.version);
}

/**
 * Logo URLs for many merchants at once, keyed by merchant id.
 *
 * For the wallet re-sync script, which walks every merchant — a per-merchant
 * query there would be one round trip per café.
 */
export async function loadLogoUrls(
  merchantIds: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (merchantIds.length === 0) return out;

  const [rows] = await pool.execute<LogoVersionRow[]>(
    `SELECT merchant_id, version
       FROM merchant_assets
      WHERE kind = 'logo'
        AND merchant_id IN (${merchantIds.map(() => "?").join(",")})`,
    merchantIds
  );
  for (const row of rows) {
    const url = logoUrlFromVersion(row.merchant_id, row.version);
    if (url) out.set(row.merchant_id, url);
  }
  return out;
}
