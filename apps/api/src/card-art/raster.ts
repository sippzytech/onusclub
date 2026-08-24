import { Resvg } from "@resvg/resvg-js";
import { DEFAULT_CARD_DESIGN, renderCardStrip, type CardDesign } from "@onusclub/shared";
import { logger } from "../logger.js";

/**
 * SVG → PNG for wallet pass artwork.
 *
 * Apple embeds the strip in the .pkpass bundle, and `buildPkPass` runs on
 * every device pull, so this is on a hot-ish path: a busy merchant's cards all
 * refresh at once after a broadcast. The render is pure and deterministic in
 * its inputs, so the results cache perfectly — a café with a 10-stamp card has
 * at most 11 distinct strips per design.
 */

// Apple storeCard strip, in points: 375×123. @2x and @3x are the retina
// variants Wallet actually picks on modern devices.
const STRIP_W = 375;
const STRIP_H = 123;
export const STRIP_SCALES = [1, 2, 3] as const;

export interface StripSet {
  "strip.png": Buffer;
  "strip@2x.png": Buffer;
  "strip@3x.png": Buffer;
}

// Small bounded LRU. Strips are ~30-90KB each, so a few hundred entries is a
// handful of MB — cheap next to re-rasterising on every pass refresh.
const MAX_ENTRIES = 240;
const cache = new Map<string, StripSet>();

function cacheKey(design: CardDesign, current: number, total: number): string {
  return [
    current,
    total,
    design.stampIcon,
    design.backgroundColor,
    design.stampFilledColor,
    design.stampEmptyColor,
    design.badgeStyle,
    design.pattern ?? "none",
    design.patternOpacity.toFixed(2),
  ].join("|");
}

function rasterize(svg: string, scale: number): Buffer {
  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: STRIP_W * scale },
  })
    .render()
    .asPng();
  return Buffer.from(png);
}

/**
 * Build the three strip images for a card. Returns null if rendering fails —
 * the caller then ships a pass without a strip rather than no pass at all,
 * matching how the rest of the wallet path degrades.
 */
export function buildStripSet(
  designPatch: Partial<CardDesign> | null | undefined,
  current: number,
  total: number
): StripSet | null {
  const design: CardDesign = { ...DEFAULT_CARD_DESIGN, ...(designPatch ?? {}) };
  const key = cacheKey(design, current, total);

  const hit = cache.get(key);
  if (hit) {
    // Refresh recency: delete + re-set moves it to the end of the Map's
    // insertion order, which is what makes the eviction below LRU.
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }

  try {
    const { svg } = renderCardStrip({
      current,
      total,
      design,
      width: STRIP_W,
      height: STRIP_H,
    });
    const set: StripSet = {
      "strip.png": rasterize(svg, 1),
      "strip@2x.png": rasterize(svg, 2),
      "strip@3x.png": rasterize(svg, 3),
    };

    cache.set(key, set);
    if (cache.size > MAX_ENTRIES) {
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
    return set;
  } catch (err) {
    logger.error(
      { err: (err as Error).message, current, total },
      "card-art: strip rasterisation failed"
    );
    return null;
  }
}

/** Exposed for tests / diagnostics. */
export function stripCacheSize(): number {
  return cache.size;
}
