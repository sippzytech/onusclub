// Card design templates — backlog item 16.
//
// A template is a NAMED PRESET OF DESIGN TOKENS. Nothing more. Applying one
// copies its values into the program's own `config_json.design`; from that
// moment the program owns them, editing never touches the template, and
// changing a template here never rewrites a card a customer already holds.
// (docs/card-design/README.md §2 sets out that contract.)
//
// WHY THIS SHIPPED WITHOUT ARTWORK
//
// The backlog said "blocked on ~90 commissioned motifs", which conflated two
// things. The *presets* are a dozen lines of JSON each and need no art — they
// pick from the 10 tintable icons that have existed since Day 16. Only the
// tiled background *motifs* need an illustrator, and `pattern: "icon-tile"`
// already holds that slot by tiling the chosen icon. So the gallery works
// today and gets visually richer later, with no change to this file's shape.
//
// Static, in code, versioned with the repo. No DB table: a template is data
// the renderer reads, not a record anyone writes.
//
// On copying: industry names are categories and fine to mirror. Every colour
// pairing below is ours.

import type { CardDesign, StampIconId } from "./card-art.js";

export type TemplateIndustry =
  | "Food & drink"
  | "Beauty & grooming"
  | "Health & fitness"
  | "Retail"
  | "Services";

export interface CardTemplate {
  id: string;
  name: string;
  industry: TemplateIndustry;
  /**
   * Bumped when a template's tokens change. Stored alongside the copied design
   * so "which version of Coffee Shop was this card built from" stays
   * answerable — and so a future "reset to template" knows whether there is
   * anything to reset to.
   */
  version: number;
  /** One line on the gallery tile. Says who it suits, not what colour it is. */
  blurb: string;
  /** Everything except the labels, which come from DEFAULT_CARD_DESIGN. */
  design: Omit<CardDesign, "titleText" | "progressLabel" | "rewardsLabel">;
}

/**
 * Shorthand so each entry reads as the handful of decisions it actually is,
 * rather than twelve lines of mostly-repeated keys.
 *
 * `empty` defaults to the foreground colour: an unfilled badge is an outline
 * of the thing a filled one will be, and on every palette tried that reads
 * better than a third colour.
 */
function design(
  bg: string,
  fg: string,
  icon: StampIconId,
  filled: string,
  opts: { empty?: string; badge?: CardDesign["badgeStyle"]; opacity?: number } = {}
): CardTemplate["design"] {
  return {
    backgroundColor: bg,
    foregroundColor: fg,
    labelColor: fg,
    stampIcon: icon,
    stampFilledColor: filled,
    stampEmptyColor: opts.empty ?? fg,
    badgeStyle: opts.badge ?? "filled",
    pattern: "icon-tile",
    patternOpacity: opts.opacity ?? 0.12,
  };
}

/**
 * The catalogue.
 *
 * Twenty-four, not ninety-four. Perkstar's full list runs alphabetically from
 * ATV rental to Shawarma and is mostly long-tail — "Billiard club", "Climbing
 * wall", "Lift" — which pads a gallery without helping anyone. These are the
 * trades a Netherlands-first loyalty product actually meets, and adding more
 * is a one-entry pull request whenever a real café asks.
 *
 * Ordered within each industry by how common the business is, because the
 * gallery renders in array order and the first row is what most people pick
 * from.
 */
export const CARD_TEMPLATES: CardTemplate[] = [
  // ---------- Food & drink ----------
  {
    id: "coffee-shop",
    name: "Coffee shop",
    industry: "Food & drink",
    version: 1,
    blurb: "Warm and dark, the way most espresso bars already look.",
    design: design("#2E1C12", "#F5EFE6", "cup", "#C8A24A"),
  },
  {
    id: "cafe",
    name: "Café",
    industry: "Food & drink",
    version: 1,
    blurb: "Softer and greener than the espresso-bar look. Good for all-day places.",
    design: design("#14271C", "#FFFFFF", "cup", "#C8A24A"),
  },
  {
    id: "bakery",
    name: "Bakery",
    industry: "Food & drink",
    version: 1,
    blurb: "Pale and floury, with a warm crust gold.",
    design: design("#7A4A24", "#FFF6E8", "sparkle", "#F0C987"),
  },
  {
    id: "breakfast",
    name: "Breakfast & brunch",
    industry: "Food & drink",
    version: 1,
    blurb: "Bright morning yellow on a soft dark ground.",
    design: design("#23313A", "#FFFFFF", "droplet", "#FFC857"),
  },
  {
    id: "juice-bar",
    name: "Juice & smoothies",
    industry: "Food & drink",
    version: 1,
    blurb: "Fresh and loud. The one template that is not trying to be subtle.",
    design: design("#0E5C4A", "#F2FFF9", "droplet", "#7BE495", { opacity: 0.16 }),
  },
  {
    id: "bar",
    name: "Bar",
    industry: "Food & drink",
    version: 1,
    blurb: "Near-black with a brass accent. Reads well in low light.",
    design: design("#141418", "#F0EDE6", "sparkle", "#C9A227"),
  },
  {
    id: "restaurant",
    name: "Restaurant",
    industry: "Food & drink",
    version: 1,
    blurb: "Deep and quiet. Outlined badges so it stays understated.",
    design: design("#1B1D2A", "#F4F1EA", "star", "#D4AF6A", { badge: "outline" }),
  },
  {
    id: "ice-cream",
    name: "Ice cream",
    industry: "Food & drink",
    version: 1,
    blurb: "Pastel and obviously for children.",
    design: design("#F3D9E3", "#4A2B38", "heart", "#E36588", { opacity: 0.18 }),
  },
  {
    id: "food-truck",
    name: "Food truck",
    industry: "Food & drink",
    version: 1,
    blurb: "High contrast so it survives being seen in daylight.",
    design: design("#1F1F1F", "#FFFFFF", "flower", "#FF6B35", { opacity: 0.1 }),
  },

  // ---------- Beauty & grooming ----------
  {
    id: "barber-shop",
    name: "Barber shop",
    industry: "Beauty & grooming",
    version: 1,
    blurb: "Charcoal and steel. Outlined badges, nothing decorative.",
    design: design("#1C1C1E", "#F2F2F2", "scissors", "#B0B5BD", { badge: "outline" }),
  },
  {
    id: "hair-salon",
    name: "Hair salon",
    industry: "Beauty & grooming",
    version: 1,
    blurb: "Warmer than the barber template, same tools.",
    design: design("#3B2436", "#FBF2F7", "scissors", "#D9A3B8"),
  },
  {
    id: "nail-studio",
    name: "Nail studio",
    industry: "Beauty & grooming",
    version: 1,
    blurb: "Soft rose with a strong accent — the most feminine of the set.",
    design: design("#F6E7EC", "#4A2638", "sparkle", "#C2185B", { opacity: 0.2 }),
  },
  {
    id: "beauty-salon",
    name: "Beauty salon",
    industry: "Beauty & grooming",
    version: 1,
    blurb: "Plum and gold. Reads as a treat rather than an errand.",
    design: design("#2E1A2E", "#F8EFF6", "flower", "#D4AF37"),
  },
  {
    id: "spa",
    name: "Spa & massage",
    industry: "Beauty & grooming",
    version: 1,
    blurb: "Muted and calm, deliberately low contrast.",
    design: design("#2C3B37", "#EAF2EE", "droplet", "#9FC8B5", { opacity: 0.1 }),
  },
  {
    id: "tattoo",
    name: "Tattoo studio",
    industry: "Beauty & grooming",
    version: 1,
    blurb: "Pure black and ink white. Outlined, like linework.",
    design: design("#0A0A0A", "#FFFFFF", "star", "#FFFFFF", {
      badge: "outline",
      opacity: 0.08,
    }),
  },

  // ---------- Health & fitness ----------
  {
    id: "gym",
    name: "Gym",
    industry: "Health & fitness",
    version: 1,
    blurb: "Hard contrast and a signal-orange accent.",
    design: design("#141619", "#FFFFFF", "dumbbell", "#FF5C28"),
  },
  {
    id: "yoga-studio",
    name: "Yoga & pilates",
    industry: "Health & fitness",
    version: 1,
    blurb: "Earthy and quiet — the opposite of the gym template on purpose.",
    design: design("#4A3F35", "#F7F1E8", "flower", "#C9A66B", { opacity: 0.1 }),
  },
  {
    id: "physio",
    name: "Physio & therapy",
    industry: "Health & fitness",
    version: 1,
    blurb: "Clinical blue. Outlined badges keep it from looking like a loyalty gimmick.",
    design: design("#123A5C", "#F0F7FC", "sparkle", "#6FB3E0", { badge: "outline" }),
  },

  // ---------- Retail ----------
  {
    id: "flower-shop",
    name: "Flower shop",
    industry: "Retail",
    version: 1,
    blurb: "Green ground, bloom-pink badges.",
    design: design("#1E3A2B", "#F6FFF9", "flower", "#F2789F", { opacity: 0.15 }),
  },
  {
    id: "pet-shop",
    name: "Pet shop & grooming",
    industry: "Retail",
    version: 1,
    blurb: "Friendly mid-blue with a paw badge.",
    design: design("#26384A", "#F2F8FF", "paw", "#F5A623"),
  },
  {
    id: "gift-shop",
    name: "Gift shop",
    industry: "Retail",
    version: 1,
    blurb: "Deep red and gold. Leans festive without committing to a season.",
    design: design("#5C1A28", "#FFF4F0", "gift", "#E8C46A"),
  },
  {
    id: "clothing",
    name: "Clothing & boutique",
    industry: "Retail",
    version: 1,
    blurb: "Stone and black. The most neutral template here.",
    design: design("#E8E4DD", "#1C1C1C", "star", "#1C1C1C", {
      badge: "outline",
      opacity: 0.08,
    }),
  },

  // ---------- Services ----------
  {
    id: "car-wash",
    name: "Car wash",
    industry: "Services",
    version: 1,
    blurb: "Water blue, high contrast, legible on a forecourt.",
    design: design("#0B3C5D", "#EAF6FF", "droplet", "#4FC3F7", { opacity: 0.16 }),
  },
  {
    id: "dry-cleaning",
    name: "Dry cleaning & laundry",
    industry: "Services",
    version: 1,
    blurb: "Crisp and plain. Nobody wants a decorative laundry card.",
    design: design("#2B3A55", "#FFFFFF", "sparkle", "#A8C0D8", { badge: "outline" }),
  },
];

/** Grouping for the gallery, in a fixed order so the page never reflows. */
export const TEMPLATE_INDUSTRIES: readonly TemplateIndustry[] = [
  "Food & drink",
  "Beauty & grooming",
  "Health & fitness",
  "Retail",
  "Services",
] as const;

export function templatesByIndustry(industry: TemplateIndustry): CardTemplate[] {
  return CARD_TEMPLATES.filter((t) => t.industry === industry);
}

export function findTemplate(id: string): CardTemplate | undefined {
  return CARD_TEMPLATES.find((t) => t.id === id);
}

/**
 * A template's tokens as a full CardDesign, ready to save.
 *
 * Labels come from the caller's current design rather than the template:
 * a café that has renamed "STAMPS UNTIL THE REWARD" to something in Dutch
 * should not have that silently reverted by trying a different colour scheme.
 * Restyling is not relabelling.
 */
export function applyTemplate(template: CardTemplate, current: CardDesign): CardDesign {
  return {
    ...template.design,
    titleText: current.titleText,
    progressLabel: current.progressLabel,
    rewardsLabel: current.rewardsLabel,
  };
}
