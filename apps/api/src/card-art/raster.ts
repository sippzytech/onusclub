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

// ---------------------------------------------------------------------------
// Google Wallet hero image
//
// Google's recommended hero is 1032×336 — 3.07:1, against Apple's 375×123 at
// 3.05:1. Near enough identical that renderCardStrip draws both from the same
// geometry with no second set of artwork, which is the whole point of the
// shared renderer.
//
// Unlike Apple, Google does not accept an embedded image: the class/object
// carries a URI that Google fetches server-side. So this is served from a
// public endpoint and cached here, because Google may refetch and because
// every stamp produces a different image.
// ---------------------------------------------------------------------------

export const HERO_W = 1032;
export const HERO_H = 336;

const heroCache = new Map<string, Buffer>();
const HERO_MAX_ENTRIES = 240;

/**
 * PNG of the stamp grid at Google hero dimensions. Null on failure — the
 * caller then patches the object without a hero rather than failing the sync.
 */
export function buildHeroPng(
  designPatch: Partial<CardDesign> | null | undefined,
  current: number,
  total: number
): Buffer | null {
  const design: CardDesign = { ...DEFAULT_CARD_DESIGN, ...(designPatch ?? {}) };
  const key = `hero|${cacheKey(design, current, total)}`;

  const hit = heroCache.get(key);
  if (hit) {
    heroCache.delete(key);
    heroCache.set(key, hit);
    return hit;
  }

  try {
    const { svg } = renderCardStrip({
      current,
      total,
      design,
      width: HERO_W,
      height: HERO_H,
    });
    const png = Buffer.from(
      new Resvg(svg, { fitTo: { mode: "width", value: HERO_W } }).render().asPng()
    );

    heroCache.set(key, png);
    if (heroCache.size > HERO_MAX_ENTRIES) {
      const oldest = heroCache.keys().next();
      if (!oldest.done) heroCache.delete(oldest.value);
    }
    return png;
  } catch (err) {
    logger.error(
      { err: (err as Error).message, current, total },
      "card-art: hero rasterisation failed"
    );
    return null;
  }
}

/**
 * Cache-busting token for the hero URL.
 *
 * Google caches hero images by URI and will not refetch an unchanged one, so
 * the URL has to change whenever the picture does — on every stamp, and on
 * every design edit. Without this the pass would show the grid frozen at
 * whatever it was the first time Google fetched it, which is worse than
 * showing no grid at all: it would be confidently wrong.
 *
 * Derived rather than random so the same state yields the same URL, which
 * keeps Google's cache working instead of defeating it.
 */
export function heroVersion(
  designPatch: Partial<CardDesign> | null | undefined,
  current: number,
  total: number
): string {
  const design: CardDesign = { ...DEFAULT_CARD_DESIGN, ...(designPatch ?? {}) };
  let hash = 0;
  const key = cacheKey(design, current, total);
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return `${current}-${total}-${(hash >>> 0).toString(36)}`;
}
