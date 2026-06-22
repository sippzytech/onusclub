import type { StampCardState } from "@onusclub/shared";

export interface AppleMerchantBranding {
  id: string;
  businessName: string;
  brandColor: string | null;
}

export interface AppleProgramForWallet {
  id: string;
  name: string;
  rewardText: string;
  stampsRequired: number;
}

export interface AppleCardForWallet {
  id: string;
  qrToken: string;
  state: StampCardState;
  customerName: string | null;
}

// Apple wants hex like #RRGGBB OR "rgb(r, g, b)". passkit-generator accepts
// both. We store hex on merchants; convert to rgb() for foreground/background
// since some passkit versions are picky.
function hexToRgb(hex: string): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return "rgb(17, 17, 17)";
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

function memberId(cardId: string): string {
  return cardId.replace(/-/g, "").slice(0, 8).toUpperCase();
}

/**
 * Build the storeCard pass.json structure. passkit-generator merges this on
 * top of a base template; we override every field that depends on per-merchant
 * / per-card state.
 */
export function buildApplePassJson(
  passTypeIdentifier: string,
  teamIdentifier: string,
  merchant: AppleMerchantBranding,
  program: AppleProgramForWallet,
  card: AppleCardForWallet
): Record<string, unknown> {
  const remaining = Math.max(0, program.stampsRequired - card.state.stamps_current);
  const bg = hexToRgb(merchant.brandColor ?? "#111111");

  return {
    formatVersion: 1,
    passTypeIdentifier,
    teamIdentifier,
    serialNumber: card.id,
    organizationName: merchant.businessName,
    description: `${merchant.businessName} — ${program.name}`,
    logoText: merchant.businessName,
    foregroundColor: "rgb(255, 255, 255)",
    backgroundColor: bg,
    labelColor: "rgb(255, 255, 255)",
    storeCard: {
      headerFields: [
        {
          key: "stamps",
          label: "Stamps",
          value: `${card.state.stamps_current} / ${program.stampsRequired}`,
        },
      ],
      primaryFields: [
        {
          key: "program",
          label: "Program",
          value: program.name,
        },
      ],
      secondaryFields: [
        {
          key: "member",
          label: "Member",
          value: card.customerName ?? "Member",
        },
      ],
      auxiliaryFields: [
        {
          key: "remaining",
          label: "To go",
          value: String(remaining),
        },
        {
          key: "memberId",
          label: "Member ID",
          value: memberId(card.id),
        },
      ],
      backFields: [
        {
          key: "reward",
          label: "Reward",
          value: program.rewardText,
        },
        {
          key: "progress",
          label: "Progress",
          value: `${card.state.stamps_current} of ${program.stampsRequired} stamps · ${remaining} to go`,
        },
        {
          key: "lifetime",
          label: "Lifetime",
          value: `${card.state.total_lifetime} stamps collected · ${card.state.rewards_redeemed} rewards redeemed`,
        },
        {
          key: "terms",
          label: "Terms",
          value:
            "Show this pass at the counter to earn a stamp. One stamp per visit. Reward at the threshold above. Cards may expire after extended inactivity.",
        },
      ],
    },
    // Single QR / barcode for the cashier to scan.
    barcodes: [
      {
        format: "PKBarcodeFormatQR",
        message: card.qrToken,
        messageEncoding: "iso-8859-1",
        altText: memberId(card.id),
      },
    ],
  };
}
