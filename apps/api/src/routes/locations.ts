// Shop locations — the addresses a merchant's wallet passes geofence on.
//
// Feeds `merchantLocations` on the Google LoyaltyClass and `locations` on the
// Apple pass, which is how a saved pass surfaces on the lock screen near the
// shop. Nothing here talks to either wallet: propagation is lazy, on the next
// class sync / pass refresh, matching how merchant branding already behaves.
//
// The `locations` table has existed since migration 001 with exactly the right
// columns and nothing has ever read or written it, so this needs no migration.

import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import {
  LocationInput,
  LocationPatch,
  MAX_LOCATIONS,
  parseCoordinates,
  validateCoordinates,
  type ShopLocation,
} from "@onusclub/shared";
import { pool } from "../db/pool.js";
import { authContext, requireAuth } from "../auth/middleware.js";
import { ApiError } from "../errors.js";
import { logger } from "../logger.js";

export const locationsRouter: Router = Router();

interface LocationRow extends RowDataPacket {
  id: string;
  name: string;
  address: string | null;
  latitude: string | number;
  longitude: string | number;
  created_at: Date;
}

function rowToLocation(row: LocationRow): ShopLocation {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    // mysql2 hands DECIMAL back as a string — it cannot know the value fits in
    // a double — so a raw pass-through would put "52.3676000" in a field the
    // contract types as a number, and JSON.stringify would quote it.
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function requireOwner(req: Request): void {
  const ctx = authContext(req);
  if (ctx.role !== "owner") {
    throw new ApiError(403, "owner_required", "only the merchant owner can manage locations");
  }
}

/**
 * Hosts we are willing to make an outbound request to.
 *
 * Resolving a shortened Maps link means our server fetches a URL the caller
 * supplied, which is a request-forgery surface. `isShortMapsLink` is a
 * substring test — good enough to *route* the input, useless as a control,
 * since `https://evil.example/?x=maps.app.goo.gl` matches it. So the decision
 * to make the request is gated on the parsed hostname being exactly one of
 * these, over https.
 *
 * Only the two short-link hosts. `www.google.com` was briefly in here and did
 * nothing: a full Maps URL carries its coordinates inline and never reaches
 * the resolver, and this list gates the *initial* host only — fetch follows
 * the redirect chain to google.com by itself. Entries that buy nothing still
 * widen the surface.
 */
const SHORT_LINK_HOSTS = new Set(["maps.app.goo.gl", "goo.gl"]);

/** 5s, so a hung redirect fails the request instead of holding a connection. */
const RESOLVE_TIMEOUT_MS = 5_000;

/**
 * Follow a shortened Google Maps link to the URL it actually points at.
 *
 * Needed because Google Maps' **Share** button produces
 * `https://maps.app.goo.gl/…`, which contains no coordinates at all — and
 * Share is the button a café owner will reach for. Returns null on anything
 * unexpected; the caller turns that into advice rather than a stack trace.
 */
async function resolveShortLink(input: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !SHORT_LINK_HOSTS.has(url.hostname)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RESOLVE_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), { redirect: "follow", signal: controller.signal });
    // A dead or mistyped short code 404s, and `res.url` is still a perfectly
    // valid string — so without this the caller is told "that link opened but
    // had no coordinates", which is not what happened and sends them looking
    // in the wrong place.
    if (!res.ok) return null;
    // `res.url` is the URL after redirects — the long /maps/place/… form, which
    // is where the coordinates live.
    return res.url || null;
  } catch (err) {
    logger.warn({ err, host: url.hostname }, "locations: could not resolve short maps link");
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Turn whatever the merchant gave us into a coordinate pair.
 *
 * Explicit numbers win when present — they are what the editable fields in the
 * dashboard produce, and an owner nudging a coordinate by hand should not have
 * it overridden by a stale link still sitting in the paste box.
 */
async function coordinatesFrom(input: {
  mapsUrl?: string;
  latitude?: number;
  longitude?: number;
}): Promise<{ latitude: number; longitude: number }> {
  if (input.latitude !== undefined && input.longitude !== undefined) {
    const problem = validateCoordinates(input.latitude, input.longitude);
    if (problem) throw ApiError.badRequest(problem);
    return { latitude: input.latitude, longitude: input.longitude };
  }

  const raw = input.mapsUrl ?? "";
  let parsed = parseCoordinates(raw);

  if (!parsed.ok && parsed.shortLink) {
    const resolved = await resolveShortLink(raw);
    if (!resolved) {
      throw ApiError.badRequest(
        "We could not open that shortened Maps link. Open your shop in Google Maps " +
          "and copy the link from your browser's address bar instead."
      );
    }
    parsed = parseCoordinates(resolved);
    if (!parsed.ok) {
      throw ApiError.badRequest(
        "That link opened, but had no coordinates in it. Copy the link from your " +
          "browser's address bar while looking at your shop."
      );
    }
  }

  if (!parsed.ok) throw ApiError.badRequest(parsed.reason);
  return { latitude: parsed.latitude, longitude: parsed.longitude };
}

// GET /v1/locations — this merchant's shops. Any authenticated user.
locationsRouter.get(
  "/",
  requireAuth,
  async (req: Request, res: Response<{ locations: ShopLocation[]; maxLocations: number }>) => {
    const ctx = authContext(req);
    const [rows] = await pool.execute<LocationRow[]>(
      `SELECT id, name, address, latitude, longitude, created_at
         FROM locations WHERE merchant_id = ?
        ORDER BY created_at ASC`,
      [ctx.merchantId]
    );
    return res.json({ locations: rows.map(rowToLocation), maxLocations: MAX_LOCATIONS });
  }
);

// POST /v1/locations — owner only.
locationsRouter.post("/", requireAuth, async (req: Request, res: Response<ShopLocation>) => {
  requireOwner(req);
  const ctx = authContext(req);
  const input = LocationInput.parse(req.body);

  const [countRows] = await pool.execute<RowDataPacket[]>(
    "SELECT COUNT(*) AS c FROM locations WHERE merchant_id = ?",
    [ctx.merchantId]
  );
  if (Number(countRows[0].c) >= MAX_LOCATIONS) {
    // The limit is Apple's and Google's, not a product decision, and saying so
    // stops it reading as an upsell.
    throw ApiError.badRequest(
      `You can have ${MAX_LOCATIONS} locations — that is the maximum Apple and Google ` +
        `allow on a single pass. Remove one to add another.`
    );
  }

  const coords = await coordinatesFrom(input);
  const id = randomUUID();
  await pool.execute<ResultSetHeader>(
    `INSERT INTO locations (id, merchant_id, name, address, latitude, longitude)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, ctx.merchantId, input.name, input.address ?? null, coords.latitude, coords.longitude]
  );

  const [rows] = await pool.execute<LocationRow[]>(
    `SELECT id, name, address, latitude, longitude, created_at
       FROM locations WHERE id = ? AND merchant_id = ? LIMIT 1`,
    [id, ctx.merchantId]
  );
  return res.status(201).json(rowToLocation(rows[0]));
});

// PATCH /v1/locations/:id — owner only.
locationsRouter.patch("/:id", requireAuth, async (req: Request, res: Response<ShopLocation>) => {
  requireOwner(req);
  const ctx = authContext(req);
  const input = LocationPatch.parse(req.body);

  // Scoped read first, so another merchant's id is a 404 rather than an UPDATE
  // that silently affects zero rows and reports success.
  const [existing] = await pool.execute<LocationRow[]>(
    "SELECT id FROM locations WHERE id = ? AND merchant_id = ? LIMIT 1",
    [req.params.id, ctx.merchantId]
  );
  if (existing.length === 0) throw ApiError.notFound("location not found");

  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  if (input.name !== undefined) {
    sets.push("name = ?");
    params.push(input.name);
  }
  if (input.address !== undefined) {
    sets.push("address = ?");
    params.push(input.address ?? null);
  }
  if (
    input.mapsUrl !== undefined ||
    (input.latitude !== undefined && input.longitude !== undefined)
  ) {
    const coords = await coordinatesFrom(input);
    sets.push("latitude = ?", "longitude = ?");
    params.push(coords.latitude, coords.longitude);
  }

  params.push(req.params.id, ctx.merchantId);
  await pool.execute<ResultSetHeader>(
    `UPDATE locations SET ${sets.join(", ")} WHERE id = ? AND merchant_id = ?`,
    params
  );

  const [rows] = await pool.execute<LocationRow[]>(
    `SELECT id, name, address, latitude, longitude, created_at
       FROM locations WHERE id = ? AND merchant_id = ? LIMIT 1`,
    [req.params.id, ctx.merchantId]
  );
  return res.json(rowToLocation(rows[0]));
});

// DELETE /v1/locations/:id — owner only.
locationsRouter.delete("/:id", requireAuth, async (req: Request, res: Response) => {
  requireOwner(req);
  const ctx = authContext(req);
  const [result] = await pool.execute<ResultSetHeader>(
    "DELETE FROM locations WHERE id = ? AND merchant_id = ?",
    [req.params.id, ctx.merchantId]
  );
  if (result.affectedRows === 0) throw ApiError.notFound("location not found");
  return res.status(204).end();
});
