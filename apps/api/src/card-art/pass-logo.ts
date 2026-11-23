import { Resvg } from "@resvg/resvg-js";
import { logger } from "../logger.js";
import type { LogoBytes } from "../merchants/logo.js";

/**
 * The café's own logo, as the three `logo.png` files an Apple pass carries.
 *
 * WHY THIS EXISTS
 *
 * Google has had the merchant's logo since Day 21 — `programLogo` points at
 * the public URL and Google fetches it. Apple never did: the pass shipped
 * OnUsClub's static `icon.png` plus `logoText`, which renders the business
 * *name* as plain text. So a café that had uploaded a logo saw it on Android
 * and not on iPhone, which is the gap a real owner reported.
 *
 * WHY resvg AND NOT AN IMAGE LIBRARY
 *
 * Two problems, one solution. Apple requires PNG, but `merchant_assets`
 * accepts PNG *or* JPEG, so a JPEG logo needs converting; and the upload is
 * whatever size the owner had, while Apple's logo box is 160×50pt, so it needs
 * fitting. Wrapping the original in an SVG `<image>` and rasterising solves
 * both at once with the dependency we already use for the card strip — no
 * sharp, no new native build in the Docker image.
 *
 * `preserveAspectRatio="xMinYMid meet"` scales to fit without distorting and
 * pins it left, which is where Wallet places the logo. A tall square logo
 * therefore ends up narrow rather than stretched.
 *
 * ⚠️ Transparency is preserved; a JPEG logo keeps whatever background it was
 * saved with. There is nothing we can do about that here, and guessing at a
 * matte colour would look worse than honest white.
 */

// Apple's logo area, in points. Wallet scales anything larger down anyway;
// rendering at the real size keeps the signed bundle small.
const LOGO_W = 160;
const LOGO_H = 50;

export interface PassLogoSet {
  "logo.png": Buffer;
  "logo@2x.png": Buffer;
  "logo@3x.png": Buffer;
}

// Keyed by the asset's content hash, so replacing a logo misses the cache and
// re-renders — the same reason `version` exists at all.
const MAX_ENTRIES = 120;
const cache = new Map<string, PassLogoSet>();

/**
 * Build the pass logo files, or null if the merchant has no logo or the image
 * cannot be rendered.
 *
 * Null is a normal outcome, not an error: the pass then falls back to
 * `logoText`, exactly as it did before this existed. A broken logo must never
 * cost the customer their card.
 */
export function buildPassLogoSet(logo: LogoBytes | null): PassLogoSet | null {
  if (!logo) return null;

  const hit = cache.get(logo.version);
  if (hit) {
    cache.delete(logo.version);
    cache.set(logo.version, hit);
    return hit;
  }

  try {
    const href = `data:${logo.contentType};base64,${logo.bytes.toString("base64")}`;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
      `width="${LOGO_W}" height="${LOGO_H}" viewBox="0 0 ${LOGO_W} ${LOGO_H}">` +
      `<image x="0" y="0" width="${LOGO_W}" height="${LOGO_H}" ` +
      `preserveAspectRatio="xMinYMid meet" xlink:href="${href}"/>` +
      `</svg>`;

    const render = (scale: number): Buffer =>
      Buffer.from(
        new Resvg(svg, { fitTo: { mode: "width", value: LOGO_W * scale } })
          .render()
          .asPng()
      );

    const set: PassLogoSet = {
      "logo.png": render(1),
      "logo@2x.png": render(2),
      "logo@3x.png": render(3),
    };

    cache.set(logo.version, set);
    if (cache.size > MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return set;
  } catch (err) {
    // Degrade to logoText rather than failing the pass.
    logger.warn(
      { err, contentType: logo.contentType, version: logo.version },
      "could not render pass logo — falling back to logoText"
    );
    return null;
  }
}
