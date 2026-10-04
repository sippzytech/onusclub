// Coordinate parsing for shop locations.
//
// Both Apple and Google geofence on raw latitude/longitude — neither accepts a
// street address — so somewhere a café owner has to produce two numbers. We
// deliberately do not geocode: that would mean a Maps Platform API key, billing
// on the GCP project, and a new runtime failure mode, to replace a paste box.
//
// So this parses what the owner can actually get hold of: the URL from their
// browser's address bar while looking at their own shop, or the coordinates
// typed in directly.
//
// Pure and in `shared` on purpose. The dashboard parses as you type for instant
// feedback and the API parses again as the authority, and the two must not
// disagree about what a link means.

/** What both Apple and Google cap a pass's location list at. Theirs, not ours. */
export const MAX_LOCATIONS = 10;

/**
 * Metres. Apple compares this against its own default and uses the SMALLER
 * value, so setting it can only tighten the radius, never widen it. ~150m is
 * about a city block — close enough that the pass appearing feels like it knows
 * where you are, rather than firing while you are still three streets away.
 *
 * Google does not take a radius at all; it picks its own.
 */
export const APPLE_MAX_DISTANCE_METRES = 150;

export type CoordinateSource =
  /** `!3d…!4d…` — the place itself. */
  | "place"
  /** `@lat,lng` — the map viewport's centre, which is close but not the pin. */
  | "viewport"
  /** `?q=` / `?query=` — an explicit coordinate query. */
  | "query"
  /** A raw "52.3676, 4.9041" pair, including what the number fields produce. */
  | "pair";

export type CoordinateParse =
  | { ok: true; latitude: number; longitude: number; source: CoordinateSource }
  | { ok: false; reason: string; shortLink: boolean };

/**
 * Google Maps' **Share** button returns `https://maps.app.goo.gl/…`, which
 * contains no coordinates whatsoever — and Share is the button an owner will
 * naturally press. The API resolves these by following the redirect; the
 * browser cannot (cross-origin), so it defers to the server.
 */
export function isShortMapsLink(input: string): boolean {
  return /(?:maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(input);
}

/** ±90 / ±180, and not Null Island. Shared by the parser and the number fields. */
export function validateCoordinates(latitude: number, longitude: number): string | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return "Those do not look like coordinates.";
  }
  if (latitude < -90 || latitude > 90) {
    return `Latitude must be between -90 and 90 (got ${latitude}).`;
  }
  if (longitude < -180 || longitude > 180) {
    return `Longitude must be between -180 and 180 (got ${longitude}).`;
  }
  // 0,0 is in the Gulf of Guinea. Nobody's café is there, and it is exactly
  // what a failed parse or an empty form produces — so it is far more likely to
  // be a bug than a location. Refusing it turns a silently useless geofence
  // into an error message.
  if (latitude === 0 && longitude === 0) {
    return "That is 0, 0 — in the ocean off West Africa. Check the link or the numbers.";
  }
  return null;
}

/** Matches DECIMAL(10,7), so what we echo back is exactly what gets stored. */
function round7(n: number): number {
  return Math.round(n * 1e7) / 1e7;
}

function finish(
  latitude: number,
  longitude: number,
  source: CoordinateSource
): CoordinateParse {
  const problem = validateCoordinates(latitude, longitude);
  if (problem) return { ok: false, reason: problem, shortLink: false };
  return { ok: true, latitude: round7(latitude), longitude: round7(longitude), source };
}

const NUM = "(-?\\d+(?:\\.\\d+)?)";

/**
 * Pull coordinates out of a Google Maps URL or a raw pair.
 *
 * Tried in order of how well each form identifies the *shop* rather than the
 * map:
 *
 *  1. `!3d<lat>!4d<lng>` — the place's own coordinates, embedded in the `data=`
 *     blob of a `/maps/place/…` URL.
 *  2. `@<lat>,<lng>` — the viewport centre. Present in nearly every Maps URL,
 *     but it is wherever the map happened to be scrolled to, which is why it
 *     loses to (1) when a URL carries both. A place URL almost always does.
 *  3. `q=` / `query=` coordinates, from the Maps URL API.
 *  4. A bare pair, separated by a comma or whitespace.
 *
 * Degrees/minutes/seconds (`52°22'03.4"N`) is deliberately unsupported — it is
 * a third format to get subtly wrong, and Maps offers decimals everywhere it
 * offers DMS.
 */
export function parseCoordinates(input: string): CoordinateParse {
  const raw = input.trim();
  if (!raw) {
    return { ok: false, reason: "Paste a Google Maps link, or type the coordinates.", shortLink: false };
  }

  const place = new RegExp(`!3d${NUM}!4d${NUM}`).exec(raw);
  if (place) return finish(Number(place[1]), Number(place[2]), "place");

  const viewport = new RegExp(`@${NUM},${NUM}`).exec(raw);
  if (viewport) return finish(Number(viewport[1]), Number(viewport[2]), "viewport");

  const query = new RegExp(`[?&](?:q|query|ll|daddr)=${NUM},\\s*${NUM}`).exec(raw);
  if (query) return finish(Number(query[1]), Number(query[2]), "query");

  const pair = new RegExp(`^${NUM}(?:\\s*,\\s*|\\s+)${NUM}$`).exec(raw);
  if (pair) return finish(Number(pair[1]), Number(pair[2]), "pair");

  // A short link reaches here because there is genuinely nothing in it to
  // parse. Flagged rather than rejected so the API knows to resolve it and the
  // browser knows to ask the API.
  if (isShortMapsLink(raw)) {
    return {
      ok: false,
      reason: "That is a shortened Maps link — we will try to open it.",
      shortLink: true,
    };
  }

  if (/^https?:\/\//i.test(raw)) {
    return {
      ok: false,
      reason:
        "No coordinates in that link. Open your shop in Google Maps and copy the " +
        "link from your browser's address bar — the Share button gives a short " +
        "link that does not contain them.",
      shortLink: false,
    };
  }

  return {
    ok: false,
    reason: 'Type coordinates as "52.3676, 4.9041", or paste a Google Maps link.',
    shortLink: false,
  };
}
