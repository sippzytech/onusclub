// Append-only audit trail for admin writes.
//
// This is the operator-side layer. There is a second, more important one: a
// balance adjustment also writes a `manual_adjust` row into `card_events`,
// where the *merchant* can see it on their own dashboard. An operator quietly
// changing a café's data is the real risk in this feature, and the fix is that
// they cannot do it quietly.
//
// This table covers what card_events cannot: writes with no card to attach to
// (suspending a merchant, changing a fee, forcing a password reset), and the
// before/after of each.

import type { Pool, PoolConnection, ResultSetHeader } from "mysql2/promise";
import { pool } from "../db/pool.js";
import type { AdminActor } from "./authorize.js";

/**
 * Anything that can run a query — the shared pool, or a connection already
 * inside a transaction.
 *
 * This parameter is the whole design. Passing the PoolConnection that is
 * performing the change means the audit row commits or rolls back with it: a
 * mutation that forgets to audit itself cannot commit, and an audit row for a
 * change that failed cannot survive.
 */
export type Executor = Pool | PoolConnection;

export type AdminAction =
  | "card.adjust"
  | "merchant.update"
  | "merchant.password_reset";

export interface AuditEntry {
  actor: AdminActor;
  action: AdminAction;
  merchantId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  /** Required, min 3 chars — validated in the request contract, not here. */
  reason: string;
  before?: unknown;
  after?: unknown;
}

export async function writeAuditLog(exec: Executor, entry: AuditEntry): Promise<void> {
  await exec.execute<ResultSetHeader>(
    `INSERT INTO admin_audit_log
       (actor_user_id, actor_email, action, merchant_id, target_type, target_id,
        reason, before_json, after_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.actor.userId,
      // Denormalised on purpose: there is no FK to staff_users, so the email
      // has to be stored at write time or the log stops naming anyone the day
      // an account is deleted.
      entry.actor.email,
      entry.action,
      entry.merchantId ?? null,
      entry.targetType ?? null,
      entry.targetId ?? null,
      entry.reason,
      entry.before === undefined ? null : JSON.stringify(entry.before),
      entry.after === undefined ? null : JSON.stringify(entry.after),
    ]
  );
}

/** Convenience for writes that are not inside a transaction of their own. */
export async function writeAuditLogPooled(entry: AuditEntry): Promise<void> {
  await writeAuditLog(pool, entry);
}
