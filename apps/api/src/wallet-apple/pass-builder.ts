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
 *
 * If `liveUpdate` is provided, the pass emits a `webServiceURL` +
 * `authenticationToken` so iPhone Wallet will register for push updates and
 * call back when it receives an APNs nudge. Omit it for a "static" pass.
 */
export interface LiveUpdateConfig {
  webServiceURL: string;
  authenticationToken: string;
}

export async function buildPkPass(
  merchant: AppleMerchantBranding,
  program: AppleProgramForWallet,
  card: AppleCardForWallet,
  liveUpdate?: LiveUpdateConfig
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
        ...(liveUpdate
          ? {
              webServiceURL: liveUpdate.webServiceURL,
              authenticationToken: liveUpdate.authenticationToken,
            }
          : {}),
      }
    );

    pass.type = "storeCard";
    // changeMessage drives the lock-screen notification: Wallet detects when
    // this field's value differs from the on-device copy after a pass
    // refresh and shows the message. `%@` is substituted with the new value.
    pass.headerFields.push({
      key: "stamps",
      label: "Stamps",
      value: `${card.state.stamps_current} / ${program.stampsRequired}`,
      changeMessage: "You have %@ stamps — keep going!",
    });
    // Primary field renders huge and bold but truncates ~14 chars mid-word.
    // The reward is short and is what the customer cares about; program name
    // moves to a secondary field where it ellipsises cleanly.
    pass.primaryFields.push({
      key: "reward",
      label: "Reward",
      value: program.rewardText,
    });
    pass.secondaryFields.push(
      { key: "program", label: "Program", value: program.name },
      { key: "member", label: "Member", value: card.customerName ?? "Member" }
    );
    pass.auxiliaryFields.push(
      {
        key: "remaining",
        label: "To go",
        value: String(remaining),
        // Fires when the customer hits the reward (remaining → 0).
        changeMessage: "%@ stamps to your reward",
      },
      { key: "memberId", label: "Member ID", value: memberId(card.id) }
    );
    pass.backFields.push(
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
