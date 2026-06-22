import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PKPass } from "passkit-generator";
import { logger } from "../logger.js";
import { appleWalletCredentials } from "./client.js";
import type {
  AppleCardForWallet,
  AppleMerchantBranding,
  AppleProgramForWallet,
} from "./state.js";

// Locate the assets/ directory relative to this file. Survives both tsx
// (running .ts from src/) and compiled output (running .js from dist/) —
// same trick we use for the SQL migrations.
const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = join(__dirname, "assets");

let iconCache: {
  "icon.png": Buffer;
  "icon@2x.png": Buffer;
  "icon@3x.png": Buffer;
} | null = null;

async function loadIcons(): Promise<NonNullable<typeof iconCache>> {
  if (iconCache) return iconCache;
  const [a, b, c] = await Promise.all([
    readFile(join(ASSETS_DIR, "icon.png")),
    readFile(join(ASSETS_DIR, "icon@2x.png")),
    readFile(join(ASSETS_DIR, "icon@3x.png")),
  ]);
  iconCache = { "icon.png": a, "icon@2x.png": b, "icon@3x.png": c };
  return iconCache;
}

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
 * Build a signed .pkpass buffer for a single card. Returns null if Apple
 * Wallet isn't configured on this environment — caller surfaces 503.
 *
 * passkit-generator v3 API:
 *   - Top-level pass.json keys (formatVersion, colors, ids, etc.) go in the
 *     constructor `props` arg
 *   - The pass kind (storeCard / coupon / etc.) is set via `pass.type =`
 *     which initialises empty field arrays
 *   - Fields (headerFields, primaryFields, etc.) are pushed onto array
 *     getters AFTER type is set
 *   - barcodes, locations, etc. have dedicated setter methods
 */
export async function buildPkPass(
  merchant: AppleMerchantBranding,
  program: AppleProgramForWallet,
  card: AppleCardForWallet
): Promise<Buffer | null> {
  const creds = await appleWalletCredentials();
  if (!creds) return null;

  const icons = await loadIcons();
  const remaining = Math.max(0, program.stampsRequired - card.state.stamps_current);

  try {
    const pass = new PKPass(
      icons,
      {
        signerCert: creds.signerCertPem,
        signerKey: creds.signerKeyPem,
        signerKeyPassphrase: creds.signerKeyPassphrase,
        wwdr: creds.wwdrPem,
      },
      {
        formatVersion: 1,
        passTypeIdentifier: creds.passTypeIdentifier,
        teamIdentifier: creds.teamIdentifier,
        serialNumber: card.id,
        organizationName: merchant.businessName,
        description: `${merchant.businessName} — ${program.name}`,
        logoText: merchant.businessName,
        foregroundColor: "rgb(255, 255, 255)",
        backgroundColor: hexToRgb(merchant.brandColor ?? "#111111"),
        labelColor: "rgb(255, 255, 255)",
      }
    );

    pass.type = "storeCard";
    pass.headerFields.push({
      key: "stamps",
      label: "Stamps",
      value: `${card.state.stamps_current} / ${program.stampsRequired}`,
    });
    pass.primaryFields.push({
      key: "program",
      label: "Program",
      value: program.name,
    });
    pass.secondaryFields.push({
      key: "member",
      label: "Member",
      value: card.customerName ?? "Member",
    });
    pass.auxiliaryFields.push(
      { key: "remaining", label: "To go", value: String(remaining) },
      { key: "memberId", label: "Member ID", value: memberId(card.id) }
    );
    pass.backFields.push(
      { key: "reward", label: "Reward", value: program.rewardText },
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
      }
    );

    pass.setBarcodes({
      format: "PKBarcodeFormatQR",
      message: card.qrToken,
      messageEncoding: "iso-8859-1",
      altText: memberId(card.id),
    });

    return pass.getAsBuffer();
  } catch (err) {
    logger.error(
      { err: (err as Error).message, cardId: card.id },
      "apple wallet: pass build failed"
    );
    return null;
  }
}
