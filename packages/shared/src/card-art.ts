// Card art — the single source of truth for how a stamp card *looks*.
//
// One SVG generator feeds every surface so the grid can never drift:
//   - the customer card page renders the SVG inline
//   - the Apple Wallet pass rasterises it into strip.png @1x/2x/3x
//   - Google Wallet rasterises it into the hero image
//   - the dashboard editor previews it
//
// Pure functions, zero dependencies, no DOM — so it runs identically in the
// browser and in Node. See docs/card-design/README.md for the design spec.

// ---------- Icons ----------

// Declared as a const tuple so the union type, the picker list and the zod
// enum in contracts.ts all derive from this one line.
export const STAMP_ICON_IDS = [
  "star",
  "heart",
  "cup",
  "droplet",
  "sparkle",
  "paw",
  "dumbbell",
  "scissors",
  "gift",
  "flower",
] as const;

export type StampIconId = (typeof STAMP_ICON_IDS)[number];

/** Human labels for the icon picker in the card editor. */
export const STAMP_ICON_LABELS: Record<StampIconId, string> = {
  star: "Star",
  heart: "Heart",
  cup: "Coffee cup",
  droplet: "Droplet",
  sparkle: "Sparkle",
  paw: "Paw",
  dumbbell: "Dumbbell",
  scissors: "Scissors",
  gift: "Gift",
  flower: "Flower",
};

/**
 * Every icon is drawn inside a 24×24 box so the grid renderer can scale them
 * uniformly. Each returns an SVG fragment painted in a single colour — that
 * is what makes a motif tintable to the merchant's brand colour.
 */
type IconRenderer = (color: string) => string;

function polygonPoints(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  spikes: number
): string {
  const pts: string[] = [];
  const step = Math.PI / spikes;
  for (let i = 0; i < spikes * 2; i += 1) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + i * step;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(" ");
}

const ICONS: Record<StampIconId, IconRenderer> = {
  star: (c) => `<polygon points="${polygonPoints(12, 12, 10.5, 4.4, 5)}" fill="${c}"/>`,

  heart: (c) =>
    `<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" fill="${c}"/>`,

  cup: (c) =>
    `<path d="M5.5 7h10v6a5 5 0 0 1-10 0z" fill="${c}"/>` +
    `<path d="M15.5 8.5h1.25a2.75 2.75 0 0 1 0 5.5H15.5" fill="none" stroke="${c}" stroke-width="1.7"/>` +
    `<rect x="3.8" y="19" width="13.4" height="1.9" rx="0.95" fill="${c}"/>`,

  droplet: (c) =>
    `<path d="M12 2.8c0 0-6.6 7.3-6.6 11.4a6.6 6.6 0 0 0 13.2 0C18.6 10.1 12 2.8 12 2.8z" fill="${c}"/>`,

  sparkle: (c) =>
    `<path d="M12 1.8 14.1 9.4 21.7 11.5 14.1 13.6 12 21.2 9.9 13.6 2.3 11.5 9.9 9.4z" fill="${c}"/>`,

  paw: (c) =>
    `<ellipse cx="6.9" cy="8.4" rx="2.05" ry="2.5" fill="${c}"/>` +
    `<ellipse cx="10.4" cy="6.5" rx="2.2" ry="2.7" fill="${c}"/>` +
    `<ellipse cx="13.9" cy="6.5" rx="2.2" ry="2.7" fill="${c}"/>` +
    `<ellipse cx="17.4" cy="8.4" rx="2.05" ry="2.5" fill="${c}"/>` +
    `<ellipse cx="12.1" cy="16" rx="5.4" ry="4.4" fill="${c}"/>`,

  dumbbell: (c) =>
    `<rect x="7" y="10.7" width="10" height="2.6" fill="${c}"/>` +
    `<rect x="4.3" y="7.8" width="2.9" height="8.4" rx="1" fill="${c}"/>` +
    `<rect x="16.8" y="7.8" width="2.9" height="8.4" rx="1" fill="${c}"/>` +
    `<rect x="1.9" y="9.7" width="1.9" height="4.6" rx="0.95" fill="${c}"/>` +
    `<rect x="20.2" y="9.7" width="1.9" height="4.6" rx="0.95" fill="${c}"/>`,

  scissors: (c) =>
    `<g fill="none" stroke="${c}" stroke-width="1.8" stroke-linecap="round">` +
    `<circle cx="7" cy="17.6" r="2.6"/><circle cx="17" cy="17.6" r="2.6"/>` +
    `<line x1="6.6" y1="5.4" x2="16.4" y2="15.4"/>` +
    `<line x1="17.4" y1="5.4" x2="7.6" y2="15.4"/></g>`,

  gift: (c) =>
    `<circle cx="9.3" cy="5.4" r="2.3" fill="none" stroke="${c}" stroke-width="1.7"/>` +
    `<circle cx="14.7" cy="5.4" r="2.3" fill="none" stroke="${c}" stroke-width="1.7"/>` +
    `<rect x="2.8" y="8.2" width="18.4" height="3.8" rx="0.9" fill="${c}"/>` +
    `<rect x="4.4" y="12" width="15.2" height="8.6" rx="1.1" fill="${c}"/>` +
    `<rect x="10.7" y="8.2" width="2.6" height="12.4" fill="#ffffff" fill-opacity="0.35"/>`,

  flower: (c) => {
    const petals: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
      const cx = 12 + 5.3 * Math.cos(a);
      const cy = 12 + 5.3 * Math.sin(a);
      petals.push(
        `<ellipse cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" rx="3.5" ry="3.5" fill="${c}"/>`
      );
    }
    return (
      petals.join("") +
      `<circle cx="12" cy="12" r="3.1" fill="#ffffff" fill-opacity="0.55"/>`
    );
  },
};

/**
 * A single icon on its own, for the icon picker in the card editor. Same
 * artwork the grid uses, so what you pick is exactly what you get.
 */
export function renderStampIcon(
  icon: StampIconId,
  color: string,
  size = 24
): string {
  const draw = ICONS[icon] ?? ICONS.star;
  const safe = sanitizeColor(color, "#14271C");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" role="img" aria-label="${icon}">` +
    draw(safe) +
    `</svg>`
  );
}

// ---------- Design tokens ----------

export type BadgeStyle = "filled" | "outline" | "bare";

export interface CardDesign {
  backgroundColor: string;
  foregroundColor: string;
  labelColor: string;
  stampIcon: StampIconId;
  stampFilledColor: string;
  stampEmptyColor: string;
  badgeStyle: BadgeStyle;
  /**
   * Tiled motif behind the badges. `"icon-tile"` is a PLACEHOLDER that tiles
   * the chosen stamp icon — it holds the slot until the commissioned
   * per-industry motifs land (see docs/card-design/README.md §3).
   */
  pattern: "icon-tile" | null;
  patternOpacity: number;
  titleText: string;
  progressLabel: string;
  rewardsLabel: string;
}

export const DEFAULT_CARD_DESIGN: CardDesign = {
  backgroundColor: "#14271C",
  foregroundColor: "#FFFFFF",
  labelColor: "#FFFFFF",
  stampIcon: "star",
  stampFilledColor: "#C8A24A",
  stampEmptyColor: "#FFFFFF",
  badgeStyle: "filled",
  pattern: "icon-tile",
  patternOpacity: 0.14,
  titleText: "",
  progressLabel: "STAMPS UNTIL THE REWARD",
  rewardsLabel: "AVAILABLE REWARDS",
};

// ---------- Safety ----------

const COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$|^rgba?\(\s*[\d.\s,%]+\)$/i;

/**
 * Design tokens eventually come from merchant input and the rendered SVG is
 * injected into the customer page, so a colour that is not a colour must
 * never reach the markup. Anything unrecognised falls back rather than
 * throwing — a wrong-coloured card beats a 500 on a customer's phone.
 */
export function sanitizeColor(value: string, fallback: string): string {
  const v = value.trim();
  return COLOR_RE.test(v) ? v : fallback;
}

/** Small stable hash (djb2) used to namespace SVG ids. Not cryptographic. */
function stableHash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i += 1) {
    h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

// ---------- The grid ----------

export interface StampGridOptions {
  current: number;
  total: number;
  icon: StampIconId;
  filledColor: string;
  emptyColor: string;
  badgeStyle: BadgeStyle;
  /** Fill behind a *filled* badge. Defaults to the filled colour at low alpha. */
  badgeBackground?: string | null;
  columns?: number;
  cell?: number;
  gap?: number;
  padding?: number;
  background?: string | null;
  pattern?: "icon-tile" | null;
  patternColor?: string;
  patternOpacity?: number;
  /** Rounded corner radius on the background plate. */
  radius?: number;
  /**
   * Prefix for internal SVG element ids. Two grids inlined into the same HTML
   * document share one id namespace, so a fixed id would make every grid on
   * the page paint the first one's motif. Defaults to a deterministic hash of
   * the motif inputs — stable across renders (so the raster cache still hits)
   * but distinct between different-looking grids.
   */
  idPrefix?: string;
}

export interface StampGridResult {
  svg: string;
  width: number;
  height: number;
}

/**
 * Pick a column count that fills its rows evenly. A 6-stamp card laid out at a
 * fixed 5 columns renders as 5 + 1, leaving a conspicuous hole; 3 × 2 reads as
 * a designed card. Prefers no empty slots first, then fewer rows — which lands
 * on the layouts people expect (6→3, 8→4, 9→3, 10→5, 12→4).
 */
export function balancedColumns(total: number): number {
  if (total <= 5) return Math.max(1, total);
  let best = 5;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const c of [5, 4, 3]) {
    const rows = Math.ceil(total / c);
    const score = (rows * c - total) * 10 + rows;
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

interface BadgePartsOptions {
  total: number;
  current: number;
  columns: number;
  cell: number;
  gap: number;
  originX: number;
  originY: number;
  icon: StampIconId;
  filled: string;
  empty: string;
  badgeStyle: BadgeStyle;
  badgeBackground: string | null;
}

/**
 * Emit the badge circles + icons for one grid. Shared by the web grid and the
 * wallet strip so the two can never render a different-looking card.
 */
function badgeParts(o: BadgePartsOptions): string[] {
  const draw = ICONS[o.icon] ?? ICONS.star;
  const r = o.cell / 2;
  const iconScale = (o.cell * 0.52) / 24;
  const iconOffset = (o.cell - o.cell * 0.52) / 2;
  const out: string[] = [];

  for (let i = 0; i < o.total; i += 1) {
    const col = i % o.columns;
    const row = Math.floor(i / o.columns);
    const x = o.originX + col * (o.cell + o.gap);
    const y = o.originY + row * (o.cell + o.gap);
    const isFilled = i < o.current;
    const tint = isFilled ? o.filled : o.empty;

    if (o.badgeStyle === "filled") {
      const plate = o.badgeBackground
        ? sanitizeColor(o.badgeBackground, "#FFFFFF")
        : "#FFFFFF";
      out.push(
        `<circle cx="${(x + r).toFixed(2)}" cy="${(y + r).toFixed(2)}" r="${r.toFixed(
          2
        )}" fill="${plate}" fill-opacity="${isFilled ? 1 : 0.35}"/>`
      );
    } else if (o.badgeStyle === "outline") {
      out.push(
        `<circle cx="${(x + r).toFixed(2)}" cy="${(y + r).toFixed(2)}" r="${(
          r - o.cell * 0.04
        ).toFixed(2)}" fill="none" stroke="${tint}" stroke-width="${(
          o.cell * 0.045
        ).toFixed(2)}" stroke-opacity="${isFilled ? 1 : 0.5}"/>`
      );
    }

    out.push(
      `<g transform="translate(${(x + iconOffset).toFixed(2)} ${(
        y + iconOffset
      ).toFixed(2)}) scale(${iconScale.toFixed(4)})" opacity="${
        isFilled ? 1 : 0.45
      }">${draw(tint)}</g>`
    );
  }
  return out;
}

/**
 * Render the stamp grid. Wraps at `columns` (default 5, matching how wallet
 * passes lay out a 10-stamp card as 2×5).
 */
export function renderStampGrid(opts: StampGridOptions): StampGridResult {
  const total = Math.max(0, Math.floor(opts.total));
  const current = Math.min(total, Math.max(0, Math.floor(opts.current)));
  const columns = Math.max(
    1,
    Math.min(opts.columns ?? balancedColumns(total), total || 1)
  );
  const rows = total > 0 ? Math.ceil(total / columns) : 1;

  const cell = opts.cell ?? 48;
  const gap = opts.gap ?? 10;
  const padding = opts.padding ?? 14;
  const radius = opts.radius ?? 0;

  const width = columns * cell + (columns - 1) * gap + padding * 2;
  const height = rows * cell + (rows - 1) * gap + padding * 2;

  const filled = sanitizeColor(opts.filledColor, "#C8A24A");
  const empty = sanitizeColor(opts.emptyColor, "#FFFFFF");
  const iconFor = ICONS[opts.icon] ?? ICONS.star;

  const parts: string[] = [];
  const defs: string[] = [];

  // Background plate + optional tiled motif.
  if (opts.background) {
    const bg = sanitizeColor(opts.background, "#000000");
    parts.push(
      `<rect x="0" y="0" width="${width}" height="${height}" rx="${radius}" fill="${bg}"/>`
    );
  }
  if (opts.pattern === "icon-tile") {
    const pc = sanitizeColor(opts.patternColor ?? empty, "#FFFFFF");
    const po = Math.min(1, Math.max(0, opts.patternOpacity ?? 0.14));
    const tile = 34;
    const scale = 20 / 24;
    const motifId = `${opts.idPrefix ?? `oc${stableHash(`${opts.icon}|${pc}|${po}`)}`}-motif`;
    defs.push(
      `<pattern id="${motifId}" width="${tile}" height="${tile}" patternUnits="userSpaceOnUse" patternTransform="rotate(-18)">` +
        `<g transform="translate(7 7) scale(${scale.toFixed(3)})" opacity="${po}">${iconFor(pc)}</g>` +
        `</pattern>`
    );
    parts.push(
      `<rect x="0" y="0" width="${width}" height="${height}" rx="${radius}" fill="url(#${motifId})"/>`
    );
  }

  parts.push(
    ...badgeParts({
      total,
      current,
      columns,
      cell,
      gap,
      originX: padding,
      originY: padding,
      icon: opts.icon,
      filled,
      empty,
      badgeStyle: opts.badgeStyle,
      badgeBackground: opts.badgeBackground ?? null,
    })
  );

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${current} of ${total} stamps collected">` +
    (defs.length > 0 ? `<defs>${defs.join("")}</defs>` : "") +
    parts.join("") +
    `</svg>`;

  return { svg, width, height };
}

// ---------- Wallet strip ----------

export interface CardStripOptions {
  current: number;
  total: number;
  design: CardDesign;
  /** Logical canvas size. Apple storeCard strip is 375×123pt; Google hero ~1032×336. */
  width: number;
  height: number;
}

/**
 * Render the wide artwork band that wallet passes use — Apple's `strip.png`
 * and Google's hero image.
 *
 * This cannot be the web grid scaled up: the grid's natural box is roughly
 * 1.4:1 while the strip is about 3:1. Instead the badges are sized to fit the
 * band and centred on it, with the motif filling the full width. Same badge
 * code as the web grid, so the two surfaces stay identical in style.
 */
export function renderCardStrip(opts: CardStripOptions): StampGridResult {
  const { width, height, design } = opts;
  const total = Math.max(0, Math.floor(opts.total));
  const current = Math.min(total, Math.max(0, Math.floor(opts.current)));

  const bg = sanitizeColor(design.backgroundColor, DEFAULT_CARD_DESIGN.backgroundColor);
  const filled = sanitizeColor(design.stampFilledColor, "#C8A24A");
  const empty = sanitizeColor(design.stampEmptyColor, "#FFFFFF");
  const icon: StampIconId = design.stampIcon;
  const draw = ICONS[icon] ?? ICONS.star;

  const parts: string[] = [];
  const defs: string[] = [];

  parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="${bg}"/>`);

  if (design.pattern === "icon-tile") {
    const po = Math.min(1, Math.max(0, design.patternOpacity));
    const tile = Math.round(height * 0.28);
    const scale = (tile * 0.6) / 24;
    const motifId = `oc${stableHash(`${icon}|${empty}|${po}|strip`)}-motif`;
    defs.push(
      `<pattern id="${motifId}" width="${tile}" height="${tile}" patternUnits="userSpaceOnUse" patternTransform="rotate(-18)">` +
        `<g transform="translate(${(tile * 0.2).toFixed(2)} ${(tile * 0.2).toFixed(
          2
        )}) scale(${scale.toFixed(3)})" opacity="${po}">${draw(empty)}</g>` +
        `</pattern>`
    );
    parts.push(
      `<rect x="0" y="0" width="${width}" height="${height}" fill="url(#${motifId})"/>`
    );
  }

  if (total > 0) {
    const columns = Math.min(balancedColumns(total), total);
    const rows = Math.ceil(total / columns);
    // Gap scales with the badge so dense cards stay legible.
    const gapRatio = 0.22;
    const padX = width * 0.04;
    const padY = height * 0.1;
    const cellByWidth =
      (width - padX * 2) / (columns + gapRatio * (columns - 1));
    const cellByHeight =
      (height - padY * 2) / (rows + gapRatio * (rows - 1));
    const cell = Math.min(cellByWidth, cellByHeight);
    const gap = cell * gapRatio;

    const blockW = columns * cell + (columns - 1) * gap;
    const blockH = rows * cell + (rows - 1) * gap;

    parts.push(
      ...badgeParts({
        total,
        current,
        columns,
        cell,
        gap,
        originX: (width - blockW) / 2,
        originY: (height - blockH) / 2,
        icon,
        filled,
        empty,
        badgeStyle: design.badgeStyle,
        badgeBackground: null,
      })
    );
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${current} of ${total} collected">` +
    (defs.length > 0 ? `<defs>${defs.join("")}</defs>` : "") +
    parts.join("") +
    `</svg>`;

  return { svg, width, height };
}
