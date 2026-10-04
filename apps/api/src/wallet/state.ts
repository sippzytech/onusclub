import type { CardDesign, PointsCardState, StampCardState } from "@onusclub/shared";
import { env } from "../config.js";
import { buildHeroPng, heroVersion } from "../card-art/raster.js";
import { WALLET_ISSUER_ID } from "./client.js";
import type { GeoPoint } from "../merchants/locations.js";

export interface MerchantBranding {
  id: string;
  businessName: string;
  brandColor: string | null;
  logoUrl: string | null;
  /**
   * Shops to geofence on, from `loadMerchantLocations`. Optional: omitted
   * means "do not touch the class's locations", which is what the logo re-sync
   * script wants, while an empty array means "this merchant has none".
   */
  locations?: GeoPoint[];
}

// Program-shape passed into wallet builders. Type-discriminated so the
// builders can pick the right labels + numbers without re-querying the DB.
export type ProgramForWallet = { design?: Partial<CardDesign> | null } & (
  | {
      programType: "stamp";
      id: string;
      name: string;
      rewardText: string;
      stampsRequired: number;
    }
  | {
      programType: "points";
      id: string;
      name: string;
      rewardText: string;
      pointsForReward: number;
    }
);

export type CardForWallet =
  | {
      id: string;
      qrToken: string;
      state: StampCardState;
      // Used as `accountName` on the wallet pass — surfaced to the customer as
      // "Member name". Falls back to a sensible placeholder.
      customerName: string | null;
    }
  | {
      id: string;
      qrToken: string;
      state: PointsCardState;
      customerName: string | null;
    };

function memberId(cardId: string): string {
  return cardId.replace(/-/g, "").slice(0, 8).toUpperCase();
}

export function classId(merchantId: string): string {
  return `${WALLET_ISSUER_ID}.m_${merchantId.replace(/-/g, "")}`;
}

export function objectId(cardId: string): string {
  return `${WALLET_ISSUER_ID}.c_${cardId.replace(/-/g, "")}`;
}

/**
 * Is a stored google_wallet_object_id usable right now?
 *
 * Object ids embed the issuer ("<issuerId>.c_<cardId>"), so one written under
 * a previous GOOGLE_WALLET_ISSUER_ID no longer resolves. A plain null check
 * treats such an id as valid and sends the caller at an object that does not
 * exist on the current issuer — a PATCH that 404s into a swallowed error, or a
 * save link that opens to nothing. Both fail silently, which is why this is a
 * shared helper rather than three copies of `!== null`.
 */
export function objectOnCurrentIssuer(storedObjectId: string | null): boolean {
  return (
    typeof storedObjectId === "string" &&
    storedObjectId.startsWith(`${WALLET_ISSUER_ID}.`)
  );
}

/**
 * Shown on the Wallet pass when a merchant has not uploaded their own logo
 * (there is no logo-upload UI yet — see "Wallet / card visual customization"
 * in ROADMAP.md), so in practice this is what every pass currently renders.
 *
 * It used to point at placehold.co. That was fine while the issuer was in
 * demo mode and only we could see it, but it is the image a Google reviewer
 * looks at when assessing the issuer for production — a third-party
 * placeholder graphic is not what you want representing the brand there.
 *
 * Must stay a publicly reachable HTTPS URL: Google fetches it server-side
 * when the LoyaltyClass is created, so anything behind auth or a private
 * host silently produces a logo-less pass.
 */
const FALLBACK_LOGO = "https://onusclub.com/new_logo.png";

/**
 * The logo URI a merchant's pass *should* carry right now.
 *
 * Shared by class creation and the logo re-sync script so the two cannot
 * disagree about what "correct" means — the re-sync exists precisely because
 * classes drifted away from this value and nothing noticed.
 */
export function logoUriFor(merchant: MerchantBranding): string {
  return merchant.logoUrl ?? FALLBACK_LOGO;
}

export function programLogoFor(merchant: MerchantBranding): Record<string, unknown> {
  return {
    sourceUri: { uri: logoUriFor(merchant) },
    contentDescription: {
      defaultValue: { language: "en-US", value: merchant.businessName },
    },
  };
}

/**
 * Pure mapping from our domain types into a Google Wallet LoyaltyClass body.
 * Class is the same shape for both program types — it's the per-card
 * LoyaltyObject below that carries the type-specific numbers.
 */
export function buildLoyaltyClass(
  merchant: MerchantBranding,
  program: ProgramForWallet
): Record<string, unknown> {
  return {
    id: classId(merchant.id),
    issuerName: merchant.businessName,
    programName: program.name,
    programLogo: programLogoFor(merchant),
    hexBackgroundColor: merchant.brandColor ?? "#111111",
    rewardsTier: "MEMBER",
    rewardsTierLabel: "Member",
    reviewStatus: "UNDER_REVIEW",
    textModulesData: [
      {
        id: "reward",
        header: "Reward",
        body: program.rewardText,
      },
    ],
    // ⚠️ `merchantLocations`, NOT `locations`.
    //
    // `LoyaltyClass.locations` (an array of LatLongPoint) is the field you
    // would reach for, and Google's own reference marks it: "This item is
    // deprecated! Note: This field is currently not supported to trigger geo
    // notifications." Sending it looks entirely correct — the API accepts it,
    // the class stores it, nothing errors — and no notification ever fires.
    // Do not "simplify" this back.
    //
    // Google takes coordinates only; there is no name or address field, and it
    // chooses its own radius. Max 10 on the class, and anything beyond that is
    // *rejected* rather than truncated — which would fail the whole PATCH,
    // branding included — so `loadMerchantLocations` caps the list in SQL too.
    //
    // Omitted entirely when `locations` is undefined, so a caller that does not
    // know about locations (the logo re-sync script) leaves them alone rather
    // than clearing them.
    ...(merchant.locations
      ? {
          merchantLocations: merchant.locations.map((l) => ({
            latitude: l.latitude,
            longitude: l.longitude,
          })),
        }
      : {}),
  };
}

// Tiny helper to compute the type-specific text bits in one place so build
// + patch render identically.
function renderBalanceBits(
  program: ProgramForWallet,
  card: CardForWallet
): {
  label: string;
  balanceString: string;
  progressBody: string;
  lifetimeBody: string;
} {
  if (program.programType === "points" && card.state.type === "points") {
    const remaining = Math.max(0, program.pointsForReward - card.state.points_current);
    return {
      label: "Points",
      balanceString: `${card.state.points_current} / ${program.pointsForReward}`,
      progressBody: `${card.state.points_current} of ${program.pointsForReward} points · ${remaining} to go`,
      lifetimeBody: `${card.state.total_lifetime} points earned · ${card.state.rewards_redeemed} rewards redeemed${
        card.state.total_expired > 0 ? ` · ${card.state.total_expired} expired` : ""
      }`,
    };
  }
  // Default: stamps.
  if (program.programType !== "stamp" || card.state.type !== "stamp") {
    // Type mismatch — render a safe fallback rather than throwing inside the
    // wallet path (which is best-effort and runs after the DB commit).
    return {
      label: "Loyalty",
      balanceString: "—",
      progressBody: "Card state unavailable.",
      lifetimeBody: "",
    };
  }
  const remaining = Math.max(0, program.stampsRequired - card.state.stamps_current);
  return {
    label: "Stamps",
    balanceString: `${card.state.stamps_current} / ${program.stampsRequired}`,
    progressBody: `${card.state.stamps_current} of ${program.stampsRequired} stamps · ${remaining} to go`,
    lifetimeBody: `${card.state.total_lifetime} stamps collected · ${card.state.rewards_redeemed} rewards redeemed`,
  };
}

/**
 * `heroImage` for a card's LoyaltyObject — the stamp grid, as Google's wide
 * banner.
 *
 * Google does not take an embedded image the way Apple does; it stores a URI
 * and fetches it itself. It also caches by URI and will not refetch an
 * unchanged one, so the ?v= token has to move whenever the picture does.
 * Without that the pass would show the grid frozen at whatever Google happened
 * to fetch first — confidently wrong, which is worse than absent.
 *
 * Stamp programs only, with the same <= 30 bound as the Apple strip: a grid of
 * 420/1000 is meaningless, and a mis-configured 500-stamp program should not
 * emit a wall of badges. Returns undefined otherwise so the field is simply
 * omitted.
 *
 * buildHeroPng is called here purely to confirm the image can actually be
 * produced. Handing Google a URI that 404s leaves a broken-image band on the
 * pass, so it is better to omit the field than to promise artwork that is not
 * there.
 */
function heroImageFor(
  program: ProgramForWallet,
  card: CardForWallet
): Record<string, unknown> | undefined {
  if (program.programType !== "stamp" || card.state.type !== "stamp") return undefined;
  const total = program.stampsRequired;
  const current = card.state.stamps_current;
  if (total <= 0 || total > 30) return undefined;
  if (!buildHeroPng(program.design, current, total)) return undefined;

  const base = env.BASE_URL_API.replace(/\/$/, "");
  const version = heroVersion(program.design, current, total);
  return {
    sourceUri: { uri: `${base}/v1/public/c/${card.qrToken}/hero.png?v=${version}` },
    contentDescription: {
      defaultValue: {
        language: "en-US",
        value: `${current} of ${total} stamps collected`,
      },
    },
  };
}

export function buildLoyaltyObject(
  merchant: MerchantBranding,
  program: ProgramForWallet,
  card: CardForWallet
): Record<string, unknown> {
  const bits = renderBalanceBits(program, card);
  const hero = heroImageFor(program, card);
  return {
    id: objectId(card.id),
    classId: classId(merchant.id),
    ...(hero ? { heroImage: hero } : {}),
    state: "ACTIVE",
    accountId: memberId(card.id),
    accountName: card.customerName ?? "Member",
    barcode: {
      type: "QR_CODE",
      value: card.qrToken,
      alternateText: card.qrToken.slice(0, 8),
    },
    loyaltyPoints: {
      label: bits.label,
      balance: { string: bits.balanceString },
    },
    textModulesData: [
      { id: "progress", header: "Progress", body: bits.progressBody },
      { id: "lifetime", header: "Lifetime", body: bits.lifetimeBody },
    ],
  };
}

export type WalletEvent = "signup" | "stamp" | "threshold" | "redeem";

export interface MessageContext {
  event: WalletEvent;
  businessName: string;
  rewardText: string;
  // For stamp programs: stamps_current / stamps_required.
  // For points programs: points_current / points_for_reward.
  // We keep generic names so the message renderer doesn't need a second
  // discriminator.
  currentValue: number;
  thresholdValue: number;
  unitLabel: "stamps" | "points";
  cardId: string;
}

export function buildEventMessage(ctx: MessageContext): Record<string, unknown> {
  const now = new Date();
  const expiry = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const id = `${ctx.event}-${ctx.cardId.replace(/-/g, "")}-${now.getTime()}`;
  const displayInterval = {
    kind: "walletobjects#timeInterval",
    start: { date: now.toISOString() },
    end: { date: expiry.toISOString() },
  };

  let header: string;
  let body: string;
  switch (ctx.event) {
    case "signup":
      header = `Welcome to ${ctx.businessName} rewards`;
      body =
        ctx.unitLabel === "stamps"
          ? `Earn a stamp every visit. Reward at ${ctx.thresholdValue} stamps.`
          : `Earn points on every purchase. Reward at ${ctx.thresholdValue} points.`;
      break;
    case "stamp": {
      const remaining = Math.max(0, ctx.thresholdValue - ctx.currentValue);
      header =
        ctx.unitLabel === "stamps"
          ? `+1 stamp at ${ctx.businessName}`
          : `Points added at ${ctx.businessName}`;
      body = `${ctx.currentValue}/${ctx.thresholdValue} · ${remaining} to go`;
      break;
    }
    case "threshold":
      header = `Reward unlocked at ${ctx.businessName}`;
      body = `Tap to redeem: ${ctx.rewardText}`;
      break;
    case "redeem":
      header = `Reward redeemed at ${ctx.businessName}`;
      body =
        ctx.unitLabel === "stamps"
          ? "Back to 0 — start your next one!"
          : "Points deducted — keep earning!";
      break;
  }

  return {
    id,
    messageType: "TEXT_AND_NOTIFY",
    header,
    body,
    displayInterval,
  };
}

/**
 * Partial body for a PATCH after stamp/redeem/add-points. Only fields that
 * change. accountName/accountId are included so any pass created before we
 * used customer-based identity gets corrected on the next mutation.
 */
export function buildLoyaltyObjectPatch(
  program: ProgramForWallet,
  card: CardForWallet
): Record<string, unknown> {
  const bits = renderBalanceBits(program, card);
  const hero = heroImageFor(program, card);
  return {
    accountId: memberId(card.id),
    accountName: card.customerName ?? "Member",
    ...(hero ? { heroImage: hero } : {}),
    loyaltyPoints: {
      label: bits.label,
      balance: { string: bits.balanceString },
    },
    textModulesData: [
      { id: "progress", header: "Progress", body: bits.progressBody },
      { id: "lifetime", header: "Lifetime", body: bits.lifetimeBody },
    ],
  };
}
