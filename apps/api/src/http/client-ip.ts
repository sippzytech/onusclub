// Resolving the real client address behind Traefik.
//
// `req.ip` is the proxy. In production every request arrives from Traefik on
// the Docker network, so `req.ip` is the same value for every caller on the
// planet — which makes it useless for anything that needs to tell callers
// apart: rate limiting buckets them all together, and an audit log records the
// proxy rather than whoever actually did the thing.
//
// Hoisted out of routes/leads.ts, which worked this out first and documented
// it. A second copy appeared in the admin tripwire using plain `req.ip`, and
// was logging Traefik's address for every denied request — found during the
// Day 26 security review. One implementation, so the third place to need it
// cannot get it wrong either.

import { createHash } from "node:crypto";
import type { Request } from "express";

/**
 * The first entry of X-Forwarded-For, falling back to `req.ip`.
 *
 * ⚠️ X-Forwarded-For is client-supplied and therefore spoofable: a caller can
 * send any value they like and Traefik appends to it rather than replacing it.
 * Taking the FIRST entry is the right choice for the honest case (that is
 * where the real client sits) but it means a determined attacker can rotate
 * the value and defeat an IP-keyed rate limit.
 *
 * That is accepted deliberately. The alternative — taking the last entry, or
 * configuring Express's `trust proxy` hop count — hardens against spoofing but
 * breaks attribution for every ordinary caller, which is the common case and
 * the one that matters for logs. Rate limiting by IP is a speed bump against
 * casual abuse and credential stuffing from one host, not a defence against
 * someone who has read this comment. Real protection against a determined
 * attacker is a WAF or Traefik-level limits, in front of this process.
 */
export function clientIp(req: Request): string | undefined {
  const fwd = req.headers["x-forwarded-for"];
  const raw = Array.isArray(fwd) ? fwd[0] : fwd;
  const first = raw?.split(",")[0]?.trim();
  return first || req.ip;
}

/**
 * SHA-256 of an address, for storing or logging.
 *
 * An IP is personal data under the GDPR, so anywhere it is persisted or
 * written to a log it goes through this first — the hash is still a stable key
 * for "same caller" without being a stable identifier for "this person".
 */
export function hashIp(ip: string | undefined): string | null {
  if (!ip) return null;
  return createHash("sha256").update(ip).digest("hex");
}
