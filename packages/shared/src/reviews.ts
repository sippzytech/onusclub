// Google review links.
//
// ⚠️ THIS FEATURE DOES NOT REWARD REVIEWS, AND MUST NOT.
//
// Google's Fake Engagement policy prohibits incentivising reviews and names
// loyalty points explicitly. "Review gating" — asking only the customers who
// say they enjoyed it — is banned separately. Enforcement is active: Google
// surveys users about whether a business offered a reward.
//
// The penalties land on the CAFÉ'S listing, not ours: reviews removed, a
// warning badge on the profile, a block on receiving new reviews. So an
// incentive here would be us damaging our own customer's asset.
//
// What this supports is the ASK — shown to every customer regardless of
// sentiment, with nothing offered in return. If someone later adds a reward or
// a "did you enjoy it?" step, they are not extending this feature, they are
// breaking it.

/** The link a café can actually lay hands on, in the three shapes it comes in. */
export type ReviewLinkSource =
  /** `https://g.page/r/<id>/review` — what Business Profile's "Ask for reviews" gives. */
  | "short"
  /** `https://search.google.com/local/writereview?placeid=<id>` — older, still works. */
  | "writereview"
  /** A bare Place ID, which we wrap into the writereview form. */
  | "place-id";

export type ReviewLinkParse =
  | { ok: true; url: string; source: ReviewLinkSource }
  | { ok: false; reason: string };

/**
 * Hosts we will render a link to, in front of the café's own customers.
 *
 * ⚠️ Checked against a parsed `URL.hostname`, never as a substring. A
 * substring test would accept `https://evil.example/?x=g.page`, which is
 * exactly the shape of attack this list exists to stop. Same control, and the
 * same reasoning, as SHORT_LINK_HOSTS in routes/locations.ts.
 */
const REVIEW_HOSTS = new Set(["g.page", "search.google.com", "www.google.com", "maps.google.com"]);

/**
 * Place IDs are opaque Google identifiers. The common prefix is `ChIJ`, but
 * Google does not guarantee a format, so this stays deliberately loose on
 * content and strict on shape: no spaces, no scheme, plausible length.
 */
const PLACE_ID_RE = /^[A-Za-z0-9_-]{20,128}$/;

/**
 * Turn whatever the owner pasted into a review URL we are willing to publish.
 *
 * Accepts the three forms above for the same reason `parseCoordinates` accepts
 * three forms of a Maps link: asking an SMB owner for a "Place ID" is as
 * useless as asking them for a latitude. They have a link; take the link.
 */
export function parseReviewLink(input: string): ReviewLinkParse {
  const raw = input.trim();
  if (!raw) {
    return { ok: false, reason: "Paste your Google review link." };
  }

  if (/^https?:\/\//i.test(raw)) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return { ok: false, reason: "That does not look like a link." };
    }
    if (url.protocol !== "https:") {
      return { ok: false, reason: "The link must start with https://" };
    }
    if (!REVIEW_HOSTS.has(url.hostname)) {
      return {
        ok: false,
        reason:
          "That is not a Google link. In Google, search your own business name while " +
          "signed in, press “Ask for reviews”, and copy the link it gives you.",
      };
    }
    // Strip query and fragment from the short form: Business Profile sometimes
    // appends tracking parameters, and they are no use to anyone here.
    if (url.hostname === "g.page") {
      if (!/\/review\/?$/.test(url.pathname)) {
        return {
          ok: false,
          reason: "That Google link is not a review link — it should end in /review.",
        };
      }
      return { ok: true, url: `https://g.page${url.pathname}`, source: "short" };
    }
    const placeId = url.searchParams.get("placeid");
    if (placeId) {
      return {
        ok: true,
        url: `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`,
        source: "writereview",
      };
    }
    return {
      ok: false,
      reason:
        "That Google link does not point at a review form. Use the link from " +
        "“Ask for reviews” on your Business Profile.",
    };
  }

  if (PLACE_ID_RE.test(raw)) {
    return {
      ok: true,
      url: `https://search.google.com/local/writereview?placeid=${encodeURIComponent(raw)}`,
      source: "place-id",
    };
  }

  return {
    ok: false,
    reason:
      "Paste the link from “Ask for reviews” on your Google Business Profile — " +
      "it looks like https://g.page/r/…/review",
  };
}

/**
 * Re-check a stored URL before rendering it.
 *
 * The row could predate a tightening of the rules above, and the cost of being
 * wrong is a link to somewhere else shown to a café's customers under the
 * café's name. Cheap, so do it at serve time rather than trusting the column.
 */
export function isPublishableReviewUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const parsed = parseReviewLink(url);
  return parsed.ok;
}

/** Days after a redemption during which the ask is shown on the card. */
export const REVIEW_PROMPT_WINDOW_DAYS = 14;
