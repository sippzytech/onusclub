import type { PointsCardState, StampCardState } from "@onusclub/shared";
import { WALLET_ISSUER_ID } from "./client.js";

export interface MerchantBranding {
  id: string;
  businessName: string;
  brandColor: string | null;
  logoUrl: string | null;
}

// Program-shape passed into wallet builders. Type-discriminated so the
// builders can pick the right labels + numbers without re-querying the DB.
export type ProgramForWallet =
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
    };

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

const FALLBACK_LOGO =
  "https://placehold.co/240x240/111111/FFFFFF/png?text=OnUsClub";

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
    programLogo: {
      sourceUri: { uri: merchant.logoUrl ?? FALLBACK_LOGO },
      contentDescription: {
        defaultValue: { language: "en-US", value: merchant.businessName },
      },
    },
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

export function buildLoyaltyObject(
  merchant: MerchantBranding,
  program: ProgramForWallet,
  card: CardForWallet
): Record<string, unknown> {
  const bits = renderBalanceBits(program, card);
  return {
    id: objectId(card.id),
    classId: classId(merchant.id),
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
  return {
    accountId: memberId(card.id),
    accountName: card.customerName ?? "Member",
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
