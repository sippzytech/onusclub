/**
 * Verify a Google ID token.
 *
 * This is the whole trust boundary for Sign in with Google, on both surfaces —
 * café owner login and customer enrolment. Everything downstream treats the
 * identity this returns as proven, so nothing here is optional.
 *
 * The flow is Google Identity Services' ID-token flow: the browser renders
 * Google's button, Google hands it a JWT, and the browser posts that one string
 * to us. There is no client secret, no redirect URI, no callback route and no
 * state parameter — which removes the entire class of OAuth-redirect bugs,
 * and is why this file is 100 lines rather than a library.
 *
 * `google-auth-library` was already a dependency: the Wallet signer uses its
 * GoogleAuth. This adds no package.
 */
import { OAuth2Client } from "google-auth-library";
import { env } from "../config.js";
import { ApiError } from "../errors.js";
import { logger } from "../logger.js";

export interface GoogleIdentity {
  /** Google's immutable subject id. Stored in staff_users.google_sub. */
  sub: string;
  /** Lower-cased. Only ever returned when Google asserts it is verified. */
  email: string;
  /** Google's display name, or null — not every account has one set. */
  name: string | null;
}

export function googleConfigured(): boolean {
  return env.GOOGLE_OAUTH_CLIENT_ID !== "";
}

/**
 * Lazily constructed, like the Anthropic client, so that an unconfigured
 * deployment cannot turn "no client id" into "the api will not boot".
 */
let client: OAuth2Client | null = null;
function oauthClient(): OAuth2Client {
  if (!client) client = new OAuth2Client(env.GOOGLE_OAUTH_CLIENT_ID);
  return client;
}

/**
 * Throw the 503 that means "this deployment has no Google client id".
 *
 * Callers invoke this before doing any work, so an unconfigured box answers
 * 503 rather than 500 — the same degrade every optional integration here uses.
 */
export function requireGoogleConfigured(): void {
  if (!googleConfigured()) {
    throw new ApiError(
      503,
      "google_not_configured",
      "Sign in with Google is not switched on for this deployment"
    );
  }
}

/**
 * Verify, and return the identity Google asserts.
 *
 * ⚠️ Three checks, and each one is load-bearing:
 *
 *  1. **Signature.** `verifyIdToken` fetches Google's public keys and checks
 *     the JWT against them. Decoding the token without verifying — which is
 *     easy to do by accident, since it is just base64 — would accept anything
 *     anyone cared to type.
 *
 *  2. **Audience.** `audience` pins the token to OUR client id. Google issues
 *     ID tokens to every site using Sign in with Google; without this check, a
 *     token minted for some unrelated app would verify perfectly and we would
 *     accept whoever it named. This is the check that is easiest to leave out
 *     and worst to leave out.
 *
 *  3. **email_verified.** Rejected when false. This one carries the whole
 *     account-linking rule: a Google sign-in whose email matches an existing
 *     password account logs INTO that account, which is safe only because
 *     Google asserts the address belongs to the person signing in. Google can
 *     return unverified addresses (some Workspace configurations), and
 *     accepting one would be an account-takeover path.
 *
 * Every failure raises 401 with the same generic message, and the reason is
 * logged instead. A caller learning *why* their forged token was rejected is
 * being handed a tool for forging a better one.
 */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity> {
  requireGoogleConfigured();

  let payload;
  try {
    const ticket = await oauthClient().verifyIdToken({
      idToken,
      audience: env.GOOGLE_OAUTH_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch (err) {
    // Covers a bad signature, an expired token, a wrong audience, and a string
    // that is not a JWT at all. Also covers Google's key endpoint being
    // unreachable, which is indistinguishable from here — and failing closed
    // is the only safe direction.
    logger.warn({ err }, "google id token did not verify");
    throw ApiError.unauthorized("Google sign-in failed");
  }

  if (!payload) {
    logger.warn("google id token verified but carried no payload");
    throw ApiError.unauthorized("Google sign-in failed");
  }

  if (!payload.email) {
    logger.warn({ sub: payload.sub }, "google id token carried no email");
    throw ApiError.unauthorized("Google sign-in failed");
  }

  if (payload.email_verified !== true) {
    // Deliberately a distinguishable message: unlike the cases above this is
    // not a forgery, it is a real account the person must fix at Google's end,
    // and telling them "sign-in failed" would send them to us for support.
    logger.warn({ sub: payload.sub }, "google account email is not verified");
    throw ApiError.unauthorized(
      "Your Google account's email address is not verified. Verify it with Google, or use a password instead."
    );
  }

  return {
    sub: payload.sub,
    // Lower-cased because every email lookup in this codebase compares against
    // what a form posted, and MySQL's default collation is case-insensitive
    // anyway — normalising here keeps the stored value predictable.
    email: payload.email.toLowerCase(),
    name: payload.name ?? null,
  };
}
