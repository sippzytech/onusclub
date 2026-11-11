/**
 * The pure half of the block list: normalising, hashing and masking.
 *
 * Deliberately imports nothing — no config, no pool. `config.ts` validates the
 * whole environment at import time, so a module that touches it cannot be
 * tested without a full env. These are the functions whose bugs are silent, so
 * they are the ones that most need to be cheap to assert: `pnpm check:blocks`
 * runs in the typecheck job and needs no database and no variables.
 *
 * Same split as `ai/prompt.ts` (pure) against `ai/client.ts` (env + network).
 * The env-bound wrappers live in `blocks.ts`.
 */
import { createHash, createHmac } from "node:crypto";

/**
 * Normalise before hashing, or the same person blocks under one spelling and
 * walks back in under another.
 *
 * ⚠️ Deliberately NOT stripping Gmail dots or `+tag` suffixes. That would make
 * a block broader than the café asked for, and it cannot be undone from a
 * hash — a false positive refuses a stranger with no way for anyone to see
 * why. `check:blocks` asserts both are left alone.
 */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Digits only, so "+31 6 1234 5678" and "+31612345678" are one person. */
export function normalisePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

/**
 * One-way hash of an already-normalised identifier.
 *
 * HMAC when a pepper is given, plain SHA-256 when it is empty. The fallback
 * keeps the feature working on a box with no pepper configured, but an
 * unpeppered hash of an email is cheap to confirm for an address someone
 * already suspects — so production should set one.
 *
 * 🚨 Changing the pepper invalidates every stored block, silently: no hash
 * matches again and nothing errors.
 */
export function hashWithPepper(normalised: string, pepper: string): string {
  return pepper
    ? createHmac("sha256", pepper).update(normalised).digest("hex")
    : createHash("sha256").update(normalised).digest("hex");
}

/**
 * A fragment an admin can recognise, that is not a contact detail.
 *
 *   "jan.devries@gmail.com" → "ja•••@gmail.com"
 *   "+31612345678"          → "•••• 5678"
 *
 * The domain is kept: it is not identifying on its own, and it is what makes a
 * mistyped block recognisable in the list.
 */
export function maskForDisplay(email?: string | null, phone?: string | null): string {
  if (email) {
    const at = email.indexOf("@");
    if (at > 0) {
      const local = email.slice(0, at);
      const domain = email.slice(at);
      // One character for a very short local part — keeping two of a
      // two-character name would be the whole name.
      const keep = local.length <= 2 ? 1 : 2;
      return `${local.slice(0, keep)}•••${domain}`;
    }
  }
  if (phone) {
    const digits = normalisePhone(phone);
    return digits.length >= 4 ? `•••• ${digits.slice(-4)}` : "••••";
  }
  return "••••";
}
