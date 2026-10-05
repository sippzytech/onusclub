// Rate limiting for the endpoints where its absence actually mattered.
//
// Before this, `POST /v1/auth/login` would accept unlimited password guesses
// at whatever rate a script could manage, and `POST /v1/auth/forgot-password`
// would send unlimited email to any address that happened to exist — which is
// both a mailbox-flooding tool pointed at our own customers and a way to burn
// the entire Resend daily quota, taking every real card invite down with it.
//
// WHY HAND-ROLLED
//
// `express-rate-limit` is the obvious choice and would be right the moment
// there is more than one api container. Today there is exactly one, and the
// library's main advantage — a pluggable store — buys nothing without Redis.
// It would also still need the X-Forwarded-For resolution in ./client-ip.ts,
// since behind Traefik every request shares one `req.ip`; configuring
// `trust proxy` to fix that has its own spoofing trade-offs.
//
// A fixed-window counter in a Map is arithmetic, not cryptography. The failure
// mode of getting it slightly wrong is "the limit is off by one request", not
// "the limit can be bypassed".
//
// ⚠️ WHAT THIS IS NOT
//
//  - Not persistent. A container restart clears every bucket, so a restart
//    loop would hand an attacker a fresh allowance each time.
//  - Not shared across instances. The moment api runs more than once, each
//    replica enforces its own limit and the effective ceiling multiplies.
//  - Not proof against a distributed attacker, or against one who rotates
//    X-Forwarded-For — see the warning in ./client-ip.ts.
//
// It is a speed bump against credential stuffing and accidental abuse from a
// single host. Anything stronger belongs in front of this process, in Traefik
// or a WAF. Replace with express-rate-limit + Redis when api scales past one
// container, and note that the limits below are then per-replica.

import type { NextFunction, Request, Response } from "express";
import { ApiError } from "../errors.js";
import { logger } from "../logger.js";
import { clientIp, hashIp } from "./client-ip.js";

interface Bucket {
  count: number;
  /** Epoch ms at which this window ends and the count resets. */
  resetAt: number;
}

export interface RateLimitOptions {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Requests permitted per key per window. */
  max: number;
  /** Shown to the caller, and used as the bucket namespace. */
  name: string;
  /**
   * Bucket key. Defaults to the client address.
   *
   * Login overrides this to include the submitted email, so that one person
   * fat-fingering their own password cannot lock out everyone else behind the
   * same office NAT — and so an attacker spraying one password across many
   * accounts is still limited per account.
   */
  keyOf?: (req: Request) => string;
}

/**
 * Buckets for every limiter, namespaced by limiter name.
 *
 * Unbounded growth is prevented by the sweep below rather than an LRU: entries
 * are only interesting until their window closes, so time-based eviction is
 * both simpler and exactly right.
 */
const buckets = new Map<string, Bucket>();

/**
 * Drop expired buckets every minute.
 *
 * `unref()` so this timer never holds the process open — without it a graceful
 * shutdown would hang for up to a minute, and the SIGTERM handler in index.ts
 * would look broken.
 */
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, 60_000);
sweeper.unref();

/** Visible to tests and to a future /metrics endpoint. */
export function rateLimitBucketCount(): number {
  return buckets.size;
}

export function rateLimit(options: RateLimitOptions) {
  const { windowMs, max, name, keyOf } = options;

  return function rateLimitMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    const subject = keyOf ? keyOf(req) : (clientIp(req) ?? "unknown");
    const key = `${name}:${subject}`;
    const now = Date.now();

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    const remaining = Math.max(0, max - bucket.count);
    const retryAfterSeconds = Math.ceil((bucket.resetAt - now) / 1000);

    // Standard headers, so a well-behaved client can back off on its own
    // rather than hammering until it gets a 429.
    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(retryAfterSeconds));

    if (bucket.count > max) {
      res.setHeader("Retry-After", String(retryAfterSeconds));
      // Logged with a HASHED address: an IP is personal data, and this line
      // would otherwise put raw addresses in the container logs forever.
      logger.warn(
        {
          limiter: name,
          ipHash: hashIp(clientIp(req)),
          path: req.originalUrl,
          count: bucket.count,
        },
        "rate limit exceeded"
      );
      next(
        new ApiError(
          429,
          "rate_limited",
          `Too many attempts. Try again in ${retryAfterSeconds} second${
            retryAfterSeconds === 1 ? "" : "s"
          }.`
        )
      );
      return;
    }

    next();
  };
}

// ---------------------------------------------------------------------------
// The limiters, with the reasoning for each number.
//
// All of these are generous for a real café owner and restrictive for a
// script. The failure they are tuned against is "someone is trying every
// password", not "someone mistyped theirs twice".
// ---------------------------------------------------------------------------

/**
 * Password login. Keyed on address AND the submitted email.
 *
 * Address alone would let one person behind an office NAT lock out their
 * colleagues. Email alone would let an attacker lock a known owner out of
 * their own account from anywhere — a denial-of-service handed over for free.
 * Together, the limit only bites the pair that is actually failing.
 */
export const loginLimiter = rateLimit({
  name: "login",
  windowMs: 15 * 60_000,
  max: 10,
  keyOf: (req) => {
    const email = (req.body as { email?: unknown } | undefined)?.email;
    const normalised = typeof email === "string" ? email.toLowerCase().trim() : "?";
    return `${clientIp(req) ?? "unknown"}|${normalised}`;
  },
});

/**
 * Password reset and magic link. Keyed on address only, deliberately.
 *
 * Keying on the target email would let an attacker flood one person's mailbox
 * by varying their own address. Keying on the sender's address caps how much
 * mail any one host can cause us to send — which is the actual resource being
 * protected, since this endpoint spends the shared Resend quota.
 */
export const passwordResetLimiter = rateLimit({
  name: "password-reset",
  windowMs: 60 * 60_000,
  max: 5,
});

/**
 * Account creation. Low, because a café owner signs up once.
 */
export const signupLimiter = rateLimit({
  name: "signup",
  windowMs: 60 * 60_000,
  max: 5,
});

/**
 * Public customer self-enrolment — the QR flow on /m/[slug].
 *
 * The only unauthenticated write that creates rows, so the only one where
 * abuse fills a café's customer list with junk. Higher than the others
 * because the honest case is a queue of real people at a counter during a
 * launch: a busy morning might genuinely see dozens of signups from the
 * café's own wifi, all sharing one address.
 */
export const publicEnrolLimiter = rateLimit({
  name: "public-enrol",
  windowMs: 10 * 60_000,
  max: 30,
});
