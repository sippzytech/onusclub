// The merchant's shop coordinates, as both wallets need them.
//
// One loader rather than a query at each call site. There are four places that
// want this — two `buildPkPass` calls and the Google class build on either side
// of `ensureLoyaltyClass` — and inline duplication across exactly this kind of
// split is what produced the colour seam that `pass-builder.ts` documents: two
// paths assembling the same merchant data slightly differently.

import type { RowDataPacket } from "mysql2";
import { MAX_LOCATIONS } from "@onusclub/shared";
import { pool } from "../db/pool.js";

export interface GeoPoint {
  /** Only Apple uses this, as the lock-screen `relevantText`. Google takes coordinates alone. */
  name: string;
  latitude: number;
  longitude: number;
}

interface LocationRow extends RowDataPacket {
  name: string;
  latitude: string | number;
  longitude: string | number;
}

/**
 * Up to `MAX_LOCATIONS` shops for a merchant, oldest first.
 *
 * The LIMIT is belt-and-braces: `POST /v1/locations` already refuses the 11th.
 * But Google *rejects* a class carrying more than ten rather than truncating
 * it, which would fail the whole class PATCH — including the branding — so a
 * row inserted by hand in SQL should degrade to "the eleventh shop is missing"
 * rather than "this café's pass stopped updating".
 *
 * Ordered by `created_at` so the set is stable between calls and the Google
 * comparator does not see a reordering as a change.
 */
export async function loadMerchantLocations(merchantId: string): Promise<GeoPoint[]> {
  const [rows] = await pool.execute<LocationRow[]>(
    `SELECT name, latitude, longitude
       FROM locations
      WHERE merchant_id = ?
      ORDER BY created_at ASC
      LIMIT ${MAX_LOCATIONS}`,
    [merchantId]
  );
  // mysql2 returns DECIMAL as a string; both wallet APIs want JSON numbers.
  return rows.map((r) => ({
    name: r.name,
    latitude: Number(r.latitude),
    longitude: Number(r.longitude),
  }));
}
