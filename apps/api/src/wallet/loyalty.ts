import jwt from "jsonwebtoken";
import type { ResultSetHeader } from "mysql2";
import { pool } from "../db/pool.js";
import { logger } from "../logger.js";
import { env } from "../config.js";
import {
  getServiceAccount,
  walletEnabled,
  walletRequest,
  WALLET_ISSUER_ID,
} from "./client.js";
import {
  buildEventMessage,
  buildLoyaltyClass,
  buildLoyaltyObject,
  buildLoyaltyObjectPatch,
  classId,
  objectId,
  type CardForWallet,
  type MerchantBranding,
  type MessageContext,
  type ProgramForWallet,
} from "./state.js";

/**
 * Idempotently register the merchant's LoyaltyClass with Google. If a class
 * already exists for this merchant id (either remotely or in our DB), this is
 * a no-op. Returns the class id on success, null on failure or when wallet
 * is offline. Failures are logged and swallowed — callers should not abort
 * the user-facing operation just because Wallet is unhappy.
 */
export async function ensureLoyaltyClass(
  merchant: MerchantBranding,
  program: ProgramForWallet,
  existingClassId: string | null
): Promise<string | null> {
  if (!(await walletEnabled())) return null;
  const id = classId(merchant.id);

  // GET to check if it already exists upstream — survives DB drift.
  const get = await walletRequest({ method: "GET", path: `/loyaltyClass/${id}` });
  if (get && get.status === 200) {
    if (!existingClassId) await persistClassId(merchant.id, id);
    return id;
  }
  if (get && get.status !== 404) {
    logger.warn({ status: get.status, data: get.data }, "wallet: GET class returned non-404");
  }

  const create = await walletRequest({
    method: "POST",
    path: "/loyaltyClass",
    body: buildLoyaltyClass(merchant, program),
  });
  if (!create || create.status >= 300) {
    logger.error(
      { status: create?.status, data: create?.data, merchantId: merchant.id },
      "wallet: failed to create LoyaltyClass"
    );
    return null;
  }
  await persistClassId(merchant.id, id);
  logger.info({ classId: id, merchantId: merchant.id }, "wallet: LoyaltyClass created");
  return id;
}

async function persistClassId(merchantId: string, classIdVal: string): Promise<void> {
  await pool.execute<ResultSetHeader>(
    "UPDATE merchants SET google_wallet_class_id = ? WHERE id = ?",
    [classIdVal, merchantId]
  );
}

export async function createLoyaltyObject(
  merchant: MerchantBranding,
  program: ProgramForWallet,
  card: CardForWallet
): Promise<string | null> {
  if (!(await walletEnabled())) return null;
  const id = objectId(card.id);

  const create = await walletRequest({
    method: "POST",
    path: "/loyaltyObject",
    body: buildLoyaltyObject(merchant, program, card),
  });
  if (!create || (create.status >= 300 && create.status !== 409)) {
    logger.error(
      { status: create?.status, data: create?.data, cardId: card.id },
      "wallet: failed to create LoyaltyObject"
    );
    return null;
  }
  // 409 means it already exists upstream — treat as success and persist the id.
  await pool.execute<ResultSetHeader>(
    "UPDATE loyalty_cards SET google_wallet_object_id = ? WHERE id = ?",
    [id, card.id]
  );
  logger.info({ objectId: id, cardId: card.id }, "wallet: LoyaltyObject created");
  return id;
}

/**
 * PATCH a card's LoyaltyObject state — used by the expiry sweep to flip a
 * card from ACTIVE to EXPIRED in Wallet (Google moves the pass to the
 * "Inactive passes" tray automatically). Best-effort: false on any failure.
 */
export async function setLoyaltyObjectState(
  cardId: string,
  state: "ACTIVE" | "EXPIRED" | "INACTIVE" | "COMPLETED"
): Promise<boolean> {
  if (!(await walletEnabled())) return false;
  const id = objectId(cardId);
  const res = await walletRequest({
    method: "PATCH",
    path: `/loyaltyObject/${id}`,
    body: { state },
  });
  if (!res || res.status >= 300) {
    logger.error(
      { status: res?.status, data: res?.data, cardId, state },
      "wallet: failed to PATCH state"
    );
    return false;
  }
  logger.info({ cardId, state }, "wallet: object state changed");
  return true;
}

export async function patchLoyaltyObject(
  program: ProgramForWallet,
  card: CardForWallet
): Promise<boolean> {
  if (!(await walletEnabled())) return false;
  const id = objectId(card.id);
  const res = await walletRequest({
    method: "PATCH",
    path: `/loyaltyObject/${id}`,
    body: buildLoyaltyObjectPatch(program, card),
  });
  if (!res || res.status >= 300) {
    logger.error(
      { status: res?.status, data: res?.data, cardId: card.id },
      "wallet: failed to PATCH LoyaltyObject"
    );
    return false;
  }
  logger.info(
    {
      cardId: card.id,
      balance:
        card.state.type === "points"
          ? card.state.points_current
          : card.state.stamps_current,
    },
    "wallet: object patched"
  );
  return true;
}

/**
 * Add a single message to a card's LoyaltyObject. Uses the addMessage endpoint
 * so messages stack into Google's rotating buffer instead of replacing it.
 * Returns true on success, false on any failure (including wallet offline).
 */
export async function sendCardMessage(ctx: MessageContext): Promise<boolean> {
  if (!(await walletEnabled())) return false;
  const id = objectId(ctx.cardId);
  const message = buildEventMessage(ctx);
  const res = await walletRequest({
    method: "POST",
    path: `/loyaltyObject/${id}/addMessage`,
    body: { message },
  });
  if (!res || res.status >= 300) {
    logger.error(
      { status: res?.status, data: res?.data, cardId: ctx.cardId, event: ctx.event },
      "wallet: failed to addMessage"
    );
    return false;
  }
  logger.info({ cardId: ctx.cardId, event: ctx.event }, "wallet: notification sent");
  return true;
}

export interface CustomCardMessageInput {
  cardId: string;
  header: string;
  body: string;
}

export interface CustomMessageResult {
  ok: boolean;
  error?: string;
}

/**
 * Send a free-form push notification to a card's pass (used by broadcasts +
 * birthday + inactivity sweeps). Returns a structured result so the caller
 * can persist the specific error per-card for retry / audit.
 */
export async function sendCustomCardMessage(
  input: CustomCardMessageInput
): Promise<CustomMessageResult> {
  if (!(await walletEnabled())) return { ok: false, error: "wallet not configured" };
  const id = objectId(input.cardId);
  const now = new Date();
  const expiry = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const messageId = `custom-${input.cardId.replace(/-/g, "")}-${now.getTime()}`;
  const message = {
    id: messageId,
    messageType: "TEXT_AND_NOTIFY",
    header: input.header,
    body: input.body,
    displayInterval: {
      kind: "walletobjects#timeInterval",
      start: { date: now.toISOString() },
      end: { date: expiry.toISOString() },
    },
  };

  const res = await walletRequest({
    method: "POST",
    path: `/loyaltyObject/${id}/addMessage`,
    body: { message },
  });
  if (!res) return { ok: false, error: "wallet request returned null" };
  if (res.status >= 300) {
    const errMsg =
      typeof res.data === "object" && res.data !== null && "error" in res.data
        ? // @ts-expect-error - Google's error shape is loose
          (res.data.error?.message as string | undefined) ?? `HTTP ${res.status}`
        : `HTTP ${res.status}`;
    return { ok: false, error: errMsg };
  }
  return { ok: true };
}

/**
 * Builds a "Save to Google Wallet" JWT, signed with the SA private key. The
 * pass that gets saved is the one referenced by objectId(card.id), which must
 * already exist upstream (createLoyaltyObject above). Returns null when the
 * wallet client is not configured.
 */
export async function buildSaveJwt(cardId: string): Promise<string | null> {
  const sa = await getServiceAccount();
  if (!sa) return null;
  const claims = {
    iss: sa.client_email,
    aud: "google",
    typ: "savetowallet",
    iat: Math.floor(Date.now() / 1000),
    origins: [new URL(env.BASE_URL_WEB).origin],
    payload: {
      loyaltyObjects: [{ id: objectId(cardId) }],
    },
  };
  return jwt.sign(claims, sa.private_key, { algorithm: "RS256" });
}

export function saveUrl(token: string): string {
  return `https://pay.google.com/gp/v/save/${token}`;
}

export { classId, objectId, WALLET_ISSUER_ID };
