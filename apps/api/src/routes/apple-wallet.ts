// Apple PassKit Web Service endpoints.
//
// These are called by the iPhone Wallet app itself (not by our front-end).
// The paths and contracts here are defined by Apple — do not rename them.
// Spec: https://developer.apple.com/library/archive/documentation/PassKit/Reference/PassKit_WebService/WebService.html
//
// All endpoints sit behind `/v1/apple-wallet`, which we configured as the
// `webServiceURL` on every issued pass. Wallet appends Apple's canonical
// paths to that prefix, e.g.
//   POST /v1/apple-wallet/v1/devices/:deviceLib/registrations/:passType/:serial
//
// Auth model: each pass embeds a per-card `authenticationToken`. Wallet
// echoes it back on every web-service call via:
//   Authorization: ApplePass <token>
// We compare against `loyalty_cards.apple_auth_token`.

import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { StampCardState } from "@stampdeck/shared";
import { pool } from "../db/pool.js";
import { env } from "../config.js";
import { logger } from "../logger.js";

export const appleWalletRouter: Router = Router();

interface CardAuthRow extends RowDataPacket {
  card_id: string;
  qr_token: string;
  apple_auth_token: string | null;
  card_state: unknown;
  status: "active" | "blocked" | "expired";
  last_event_at: Date | null;
  created_at: Date;
  merchant_id: string;
  business_name: string;
  brand_color: string | null;
  customer_name: string | null;
  program_id: string;
  program_name: string;
  reward_text: string;
  program_config: unknown;
}

interface RegistrationRow extends RowDataPacket {
  id: string;
  card_id: string;
  push_token: string;
}

interface SerialRow extends RowDataPacket {
  serial_number: string;
  card_changed_at: Date;
}

/**
 * Resolve and authenticate a (passType, serial) request. Returns the card row
 * if the Authorization header matches `apple_auth_token` for that card. Sends
 * the appropriate response status and returns null otherwise — caller should
 * just return without doing more work.
 */
async function authenticatePass(
  req: Request,
  res: Response,
  passTypeIdentifier: string,
  serialNumber: string
): Promise<CardAuthRow | null> {
  // Apple uses the card.id (UUID) as the serial. Reject obviously bogus
  // serials so we don't even query the DB.
  if (!/^[0-9a-f-]{32,36}$/i.test(serialNumber)) {
    res.status(404).end();
    return null;
  }
  if (passTypeIdentifier !== env.APPLE_PASS_TYPE_ID) {
    res.status(404).end();
    return null;
  }

  const authHeader = req.header("authorization") ?? "";
  const match = /^ApplePass\s+(.+)$/.exec(authHeader);
  const presentedToken = match?.[1]?.trim();
  if (!presentedToken) {
    res.status(401).end();
    return null;
  }

  const [rows] = await pool.execute<CardAuthRow[]>(
    `SELECT c.id AS card_id, c.qr_token, c.apple_auth_token, c.card_state, c.status,
            c.last_event_at, c.created_at,
            m.id AS merchant_id, m.business_name, m.brand_color,
            cu.name AS customer_name,
            p.id AS program_id, p.name AS program_name, p.reward_text,
            p.config_json AS program_config
       FROM loyalty_cards c
       JOIN merchants m ON m.id = c.merchant_id
       JOIN customers cu ON cu.id = c.customer_id
       JOIN loyalty_programs p ON p.id = c.program_id
      WHERE c.id = ? LIMIT 1`,
    [serialNumber]
  );
  if (rows.length === 0) {
    res.status(404).end();
    return null;
  }
  const row = rows[0];
  if (!row.apple_auth_token || row.apple_auth_token !== presentedToken) {
    res.status(401).end();
    return null;
  }
  return row;
}

/**
 * Register a device for push updates on a specific pass.
 *
 *   POST /v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber
 *
 * Body: { pushToken: "<APNs token>" }
 * Returns 201 if newly registered, 200 if it was already registered.
 */
appleWalletRouter.post(
  "/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber",
  async (req: Request, res: Response) => {
    const { deviceLibraryIdentifier, passTypeIdentifier, serialNumber } = req.params;
    const card = await authenticatePass(req, res, passTypeIdentifier, serialNumber);
    if (!card) return;

    const pushToken = (req.body as { pushToken?: string } | undefined)?.pushToken;
    if (!pushToken || typeof pushToken !== "string") {
      res.status(400).json({ error: "pushToken required" });
      return;
    }

    const [existing] = await pool.execute<RegistrationRow[]>(
      `SELECT id, card_id, push_token FROM apple_pass_registrations
        WHERE device_library_identifier = ? AND pass_type_identifier = ? AND serial_number = ?
        LIMIT 1`,
      [deviceLibraryIdentifier, passTypeIdentifier, serialNumber]
    );
    if (existing.length > 0) {
      // Idempotent — but refresh the push token in case it rotated.
      if (existing[0].push_token !== pushToken) {
        await pool.execute(
          "UPDATE apple_pass_registrations SET push_token = ? WHERE id = ?",
          [pushToken, existing[0].id]
        );
      }
      res.status(200).end();
      return;
    }

    await pool.execute<ResultSetHeader>(
      `INSERT INTO apple_pass_registrations
         (id, card_id, device_library_identifier, push_token, pass_type_identifier, serial_number)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        card.card_id,
        deviceLibraryIdentifier,
        pushToken,
        passTypeIdentifier,
        serialNumber,
      ]
    );
    logger.info(
      { cardId: card.card_id, deviceLibraryIdentifier, passTypeIdentifier },
      "apple wallet: device registered for push updates"
    );
    res.status(201).end();
  }
);

/**
 * Unregister a device from a specific pass.
 *
 *   DELETE /v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber
 *
 * Returns 200 whether the row existed or not (idempotent).
 */
appleWalletRouter.delete(
  "/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber",
  async (req: Request, res: Response) => {
    const { deviceLibraryIdentifier, passTypeIdentifier, serialNumber } = req.params;
    const card = await authenticatePass(req, res, passTypeIdentifier, serialNumber);
    if (!card) return;

    await pool.execute<ResultSetHeader>(
      `DELETE FROM apple_pass_registrations
        WHERE device_library_identifier = ? AND pass_type_identifier = ? AND serial_number = ?`,
      [deviceLibraryIdentifier, passTypeIdentifier, serialNumber]
    );
    logger.info(
      { cardId: card.card_id, deviceLibraryIdentifier, passTypeIdentifier },
      "apple wallet: device unregistered"
    );
    res.status(200).end();
  }
);

/**
 * Wallet polls this after receiving an APNs push to discover which serials it
 * needs to re-download.
 *
 *   GET /v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier
 *       ?passesUpdatedSince=<unix-seconds-or-tag>
 *
 * NOT authenticated by ApplePass token (Apple's design — this endpoint is
 * scoped only by device library id, which the device generated itself).
 *
 * We return every serial registered to this device for this pass type whose
 * last_updated_at is greater than the passesUpdatedSince tag. The tag we
 * return is a stringified timestamp of the latest row.
 */
appleWalletRouter.get(
  "/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier",
  async (req: Request, res: Response) => {
    const { deviceLibraryIdentifier, passTypeIdentifier } = req.params;
    const sinceParam = req.query.passesUpdatedSince;
    const since =
      typeof sinceParam === "string" && /^\d+$/.test(sinceParam)
        ? new Date(parseInt(sinceParam, 10) * 1000)
        : new Date(0);

    // We answer "what serials have updated content since `since`?". The
    // pass content changes when the card's last_event_at changes (stamp /
    // redeem / expiry), NOT when the registration row itself changes — so
    // we JOIN to loyalty_cards and filter on c.last_event_at. Falling back
    // to c.created_at handles cards that have had no events yet.
    const [rows] = await pool.execute<SerialRow[]>(
      `SELECT r.serial_number,
              COALESCE(c.last_event_at, c.created_at) AS card_changed_at
         FROM apple_pass_registrations r
         JOIN loyalty_cards c ON c.id = r.card_id
        WHERE r.device_library_identifier = ?
          AND r.pass_type_identifier = ?
          AND COALESCE(c.last_event_at, c.created_at) > ?`,
      [deviceLibraryIdentifier, passTypeIdentifier, since]
    );

    if (rows.length === 0) {
      res.status(204).end();
      return;
    }

    const latest = rows.reduce((acc, r) => {
      const t = new Date(r.card_changed_at).getTime();
      return t > acc ? t : acc;
    }, 0);
    res.status(200).json({
      serialNumbers: rows.map((r) => r.serial_number),
      lastUpdated: String(Math.floor(latest / 1000)),
    });
  }
);

/**
 * Re-download the latest pass for a serial. Wallet calls this after the
 * list-updated endpoint tells it the serial is stale.
 *
 *   GET /v1/passes/:passTypeIdentifier/:serialNumber
 *
 * Returns the freshly signed .pkpass with current card state.
 */
appleWalletRouter.get(
  "/v1/passes/:passTypeIdentifier/:serialNumber",
  async (req: Request, res: Response) => {
    const { passTypeIdentifier, serialNumber } = req.params;
    const card = await authenticatePass(req, res, passTypeIdentifier, serialNumber);
    if (!card) return;
    if (card.status !== "active") {
      res.status(410).end(); // gone — Wallet will mark expired
      return;
    }

    const state =
      typeof card.card_state === "string"
        ? (JSON.parse(card.card_state) as StampCardState)
        : (card.card_state as StampCardState);
    const cfg =
      typeof card.program_config === "string"
        ? (JSON.parse(card.program_config) as { stamps_required?: number })
        : (card.program_config as { stamps_required?: number });

    const { buildPkPass } = await import("../wallet-apple/pass-builder.js");
    const buf = await buildPkPass(
      {
        id: card.merchant_id,
        businessName: card.business_name,
        brandColor: card.brand_color,
      },
      {
        id: card.program_id,
        name: card.program_name,
        rewardText: card.reward_text,
        stampsRequired: cfg.stamps_required ?? 0,
      },
      {
        id: card.card_id,
        qrToken: card.qr_token,
        state,
        customerName: card.customer_name,
      },
      env.BASE_URL_API.startsWith("https://")
        ? {
            webServiceURL: `${env.BASE_URL_API.replace(/\/$/, "")}/v1/apple-wallet`,
            authenticationToken: card.apple_auth_token!,
          }
        : undefined
    );
    if (!buf) {
      res.status(503).end();
      return;
    }
    res.setHeader("Content-Type", "application/vnd.apple.pkpass");
    res.setHeader("Cache-Control", "no-store");
    // iOS Wallet refuses to swap the pass in-place unless we set a
    // Last-Modified header — it uses this to verify the response really is
    // newer than what's already on the device.
    const lastModified = card.last_event_at ?? card.created_at;
    res.setHeader("Last-Modified", new Date(lastModified).toUTCString());
    res.send(buf);
  }
);

/**
 * Apple Wallet posts here when it encounters errors processing a pass. We
 * just log them so they show up in our pino stream.
 *
 *   POST /v1/log
 *   { "logs": ["error message 1", "error message 2"] }
 */
appleWalletRouter.post("/v1/log", (req: Request, res: Response) => {
  const body = req.body as { logs?: unknown } | undefined;
  if (body?.logs && Array.isArray(body.logs)) {
    for (const line of body.logs) {
      logger.warn({ source: "apple-wallet-device" }, String(line));
    }
  }
  res.status(200).end();
});
