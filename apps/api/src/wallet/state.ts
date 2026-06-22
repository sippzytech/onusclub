import type { StampCardState } from "@onusclub/shared";
import { WALLET_ISSUER_ID } from "./client.js";

export interface MerchantBranding {
  id: string;
  businessName: string;
  brandColor: string | null;
  logoUrl: string | null;
}

export interface ProgramForWallet {
  id: string;
  name: string;
  rewardText: string;
  stampsRequired: number;
}

export interface CardForWallet {
  id: string;
  qrToken: string;
  state: StampCardState;
  // Used as `accountName` on the wallet pass — surfaced to the customer as
  // "Member name". Falls back to a sensible placeholder if the merchant
  // hasn't captured a customer name.
  customerName: string | null;
}

function memberId(cardId: string): string {
  // Short, copy-friendly id surfaced on the pass as "Member ID". Using the
  // first 8 hex chars of the card UUID — long enough to disambiguate in any
  // single merchant, short enough to read aloud on the phone.
  return cardId.replace(/-/g, "").slice(0, 8).toUpperCase();
}

export function classId(merchantId: string): string {
  return `${WALLET_ISSUER_ID}.m_${merchantId.replace(/-/g, "")}`;
}

export function objectId(cardId: string): string {
  return `${WALLET_ISSUER_ID}.c_${cardId.replace(/-/g, "")}`;
}

// Google Wallet's image fetcher rejects URLs it can't load (hotlink-protected
// hosts, redirects, etc.). placehold.co serves a real direct PNG with no such
// quirks and is fine as a placeholder until merchants upload a real logo.
const FALLBACK_LOGO =
  "https://placehold.co/240x240/111111/FFFFFF/png?text=OnUsClub";

/**
 * Pure mapping from our domain types into a Google Wallet LoyaltyClass body.
 * Kept here (no I/O) so the wire shape is easy to evolve when we add new
 * program types or branding fields.
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

export function buildLoyaltyObject(
  merchant: MerchantBranding,
  program: ProgramForWallet,
  card: CardForWallet
): Record<string, unknown> {
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
      label: "Stamps",
      balance: { string: `${card.state.stamps_current} / ${program.stampsRequired}` },
    },
    textModulesData: [
      {
        id: "progress",
        header: "Progress",
        body: `${card.state.stamps_current} of ${program.stampsRequired} stamps · ${
          program.stampsRequired - card.state.stamps_current
        } to go`,
      },
      {
        id: "lifetime",
        header: "Lifetime",
        body: `${card.state.total_lifetime} stamps collected · ${card.state.rewards_redeemed} rewards redeemed`,
      },
    ],
  };
}

export type WalletEvent = "signup" | "stamp" | "threshold" | "redeem";

export interface MessageContext {
  event: WalletEvent;
  businessName: string;
  rewardText: string;
  stampsCurrent: number;
  stampsRequired: number;
  cardId: string;
}

/**
 * Build a Google Wallet `message` object for a card lifecycle event. Use with
 * the addMessage endpoint so that the message is appended to the pass's
 * rotating buffer (Google keeps the most recent ~10). All messages are
 * TEXT_AND_NOTIFY: the customer's phone gets a real push notification, unless
 * they've muted this pass in Wallet settings (always their call).
 *
 * The id is timestamped per call so re-sending the same event still delivers
 * a fresh notification (Google dedupes by id).
 */
export function buildEventMessage(ctx: MessageContext): Record<string, unknown> {
  const now = new Date();
  const expiry = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days
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
      body = `Earn a stamp every visit. Reward at ${ctx.stampsRequired} stamps.`;
      break;
    case "stamp": {
      const remaining = ctx.stampsRequired - ctx.stampsCurrent;
      header = `+1 stamp at ${ctx.businessName}`;
      body = `${ctx.stampsCurrent}/${ctx.stampsRequired} · ${remaining} to go`;
      break;
    }
    case "threshold":
      header = `Reward unlocked at ${ctx.businessName}`;
      body = `Tap to redeem: ${ctx.rewardText}`;
      break;
    case "redeem":
      header = `Reward redeemed at ${ctx.businessName}`;
      body = `Back to 0 — start your next one!`;
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
 * Partial body for a PATCH after stamp/redeem. Only the fields that change.
 * accountName/accountId are included so any existing pass that was created
 * before we used customer-based identity gets corrected on the next mutation.
 */
export function buildLoyaltyObjectPatch(
  program: ProgramForWallet,
  card: CardForWallet
): Record<string, unknown> {
  return {
    accountId: memberId(card.id),
    accountName: card.customerName ?? "Member",
    loyaltyPoints: {
      label: "Stamps",
      balance: { string: `${card.state.stamps_current} / ${program.stampsRequired}` },
    },
    textModulesData: [
      {
        id: "progress",
        header: "Progress",
        body: `${card.state.stamps_current} of ${program.stampsRequired} stamps · ${
          program.stampsRequired - card.state.stamps_current
        } to go`,
      },
      {
        id: "lifetime",
        header: "Lifetime",
        body: `${card.state.total_lifetime} stamps collected · ${card.state.rewards_redeemed} rewards redeemed`,
      },
    ],
  };
}
