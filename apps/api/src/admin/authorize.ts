// The platform-admin gate.
//
// This is the only module in `src/` permitted to reference the
// `platform_admins` table — a CI step asserts that, so a second read path
// cannot quietly appear somewhere with weaker checks. See
// 012_platform_admin.sql for why membership is a table rather than a role on
// the JWT.
//
// Two properties worth stating, because both are easy to "optimise" away:
//
//  1. The check hits the database on EVERY request. Not the token. That is the
//     entire point: `DELETE FROM platform_admins` revokes access immediately,
//     mid-session, instead of waiting out a 7-day JWT.
//
//  2. Therefore it is NOT cached. The cost is one primary-key read, only on
//     /v1/admin/*, for a caller population currently numbering one. Caching it
//     would trade the only property that justifies the design for an
//     unmeasurable saving.

import type { NextFunction, Request, Response } from "express";
import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool.js";
import { ApiError } from "../errors.js";
import { logger } from "../logger.js";
import { authContext } from "../auth/middleware.js";
import { clientIp, hashIp } from "../http/client-ip.js";

/** Who is making an admin request. Captured for the audit log. */
export interface AdminActor {
  userId: string;
  email: string;
  /** The admin's own merchant — irrelevant to what they can reach, kept for the log. */
  merchantId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      adminActor?: AdminActor;
    }
  }
}

interface AdminRow extends RowDataPacket {
  staff_user_id: string;
  email: string;
  merchant_id: string;
}

/**
 * Look up platform-admin membership for a staff user.
 *
 * Joined against `staff_users` rather than read alone, so a grant whose
 * account has been deleted cannot authorize anything even if the cascade in
 * the FK somehow did not fire.
 */
async function loadAdmin(userId: string): Promise<AdminActor | null> {
  const [rows] = await pool.execute<AdminRow[]>(
    `SELECT pa.staff_user_id, su.email, su.merchant_id
       FROM platform_admins pa
       JOIN staff_users su ON su.id = pa.staff_user_id
      WHERE pa.staff_user_id = ?
      LIMIT 1`,
    [userId]
  );
  if (rows.length === 0) return null;
  return { userId: rows[0].staff_user_id, email: rows[0].email, merchantId: rows[0].merchant_id };
}

/**
 * True if this staff user holds platform admin. Used by GET /v1/me to decide
 * whether to show the admin link in the dashboard — advisory UI only. The
 * actual gate is `requirePlatformAdmin`; nothing trusts this answer for
 * access.
 */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  return (await loadAdmin(userId)) !== null;
}

/**
 * Gate for everything under /v1/admin. Mounted once, on the router, rather
 * than per route — see the mount in index.ts for why.
 *
 * Denials answer 404, not 403. A 403 confirms the namespace exists and that
 * some accounts can reach it, which is a small leak and a large invitation.
 * It also matches what the cross-tenant isolation suite already asserts
 * everywhere else.
 */
export function requirePlatformAdmin(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const ctx = authContext(req);
  void loadAdmin(ctx.userId)
    .then((actor) => {
      if (!actor) {
        // The tripwire. A merchant's own session reaching this path is either
        // a bug in our UI or someone probing, and both are worth seeing in the
        // logs rather than discovering later.
        logger.warn(
          {
            userId: ctx.userId,
            merchantId: ctx.merchantId,
            role: ctx.role,
            path: req.originalUrl,
            // Hashed, and resolved through X-Forwarded-For. This used to be
            // `req.ip`, which behind Traefik is the proxy — so the tripwire
            // recorded the same address for every denied request and could
            // not distinguish a probe from our own UI. An IP is also personal
            // data, so it is hashed rather than logged raw.
            ipHash: hashIp(clientIp(req)),
          },
          "platform admin denied"
        );
        next(ApiError.notFound());
        return;
      }
      req.adminActor = actor;
      next();
    })
    .catch(next);
}

/** The authenticated admin, for handlers mounted behind the gate. */
export function adminContext(req: Request): AdminActor {
  // Unreachable behind the mount; throwing rather than asserting non-null so
  // that a future hand-mounted route fails closed instead of writing an audit
  // row with an empty actor.
  if (!req.adminActor) throw ApiError.notFound();
  return req.adminActor;
}
