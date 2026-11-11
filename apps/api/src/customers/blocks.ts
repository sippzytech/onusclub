/**
 * The customer block list.
 *
 * A café can refuse to serve someone again, and a platform admin can refuse on
 * behalf of every café. See `018_customer_blocks.sql` for why this stores
 * hashes rather than addresses.
 *
 * Blocking is two writes that belong together:
 *   - every card at that café goes to `status = 'blocked'`, which the existing
 *     guards in `cards/operations.ts` already enforce, and
 *   - a row here, which stops them simply enrolling again.
 */
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { env } from "../config.js";
import { pool } from "../db/pool.js";
import {
  hashWithPepper,
  maskForDisplay,
  normaliseEmail,
  normalisePhone,
} from "./block-hash.js";

// Re-exported so callers have one import for the whole block-list surface.
export { maskForDisplay, normaliseEmail, normalisePhone } from "./block-hash.js";

/** Same shape as the audit log's executor — lets callers pass a transaction. */
type Executor = typeof pool | PoolConnection;

/**
 * Env-bound wrapper over the pure hash. Everything that makes this testable
 * lives in block-hash.ts; this file is the part that needs config and a pool.
 */
export function hashIdentifier(normalised: string): string {
  return hashWithPepper(normalised, env.BLOCKLIST_PEPPER);
}

export interface BlockInput {
  /** Null = platform-wide. Only a platform admin may pass null. */
  merchantId: string | null;
  email?: string | null;
  phone?: string | null;
  reason: string;
  actorUserId: string;
  actorEmail: string;
}

/**
 * Record a block. Caller is responsible for also blocking the cards — see the
 * route handlers, which do both inside one transaction.
 */
export async function recordBlock(exec: Executor, input: BlockInput): Promise<void> {
  const emailHash = input.email ? hashIdentifier(normaliseEmail(input.email)) : null;
  const phoneHash = input.phone ? hashIdentifier(normalisePhone(input.phone)) : null;

  // Nothing to match on later would make the row decorative.
  if (!emailHash && !phoneHash) {
    throw new Error("cannot block a customer with neither an email nor a phone");
  }

  await exec.execute(
    `INSERT INTO customer_blocks
       (merchant_id, email_hash, phone_hash, display_hint, reason, actor_user_id, actor_email)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.merchantId,
      emailHash,
      phoneHash,
      maskForDisplay(input.email, input.phone),
      input.reason,
      input.actorUserId,
      input.actorEmail,
    ]
  );
}

interface BlockHitRow extends RowDataPacket {
  id: number;
  merchant_id: string | null;
}

/**
 * Is this person blocked at this café, or everywhere?
 *
 * Called on the unauthenticated enrolment path, so it is one indexed query
 * and it fails **closed** only on a real hit — a database error propagates
 * rather than silently letting someone through.
 */
export async function findBlock(
  merchantId: string,
  email?: string | null,
  phone?: string | null
): Promise<{ blockedPlatformWide: boolean } | null> {
  const hashes: string[] = [];
  if (email) hashes.push(hashIdentifier(normaliseEmail(email)));
  if (phone) hashes.push(hashIdentifier(normalisePhone(phone)));
  if (hashes.length === 0) return null;

  const placeholders = hashes.map(() => "?").join(",");
  const [rows] = await pool.execute<BlockHitRow[]>(
    `SELECT id, merchant_id
       FROM customer_blocks
      WHERE (merchant_id = ? OR merchant_id IS NULL)
        AND (email_hash IN (${placeholders}) OR phone_hash IN (${placeholders}))
      LIMIT 1`,
    [merchantId, ...hashes, ...hashes]
  );
  if (rows.length === 0) return null;
  return { blockedPlatformWide: rows[0].merchant_id === null };
}
