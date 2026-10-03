import jwt from "jsonwebtoken";
import { env } from "../config.js";

export interface JwtPayload {
  userId: string;
  merchantId: string;
  role: "owner" | "staff";
}

const EXPIRES_IN = "7d";

/**
 * The only roles that may appear in a token.
 *
 * Validated on the way in, not just typed. `role` was previously declared in
 * JwtPayload but never checked by verifyJwt, so a token carrying any string at
 * all — `role: "superadmin"` — passed verification and arrived at handlers as
 * a well-typed value. Nothing exploited it, because nothing branched on role
 * for privilege. Closing it before anything does.
 *
 * Note this is why platform admin is a database row and not a role here: a
 * privilege inside a 7-day bearer token with no denylist cannot be revoked.
 * See 012_platform_admin.sql.
 */
const ROLES = new Set<JwtPayload["role"]>(["owner", "staff"]);

export function signJwt(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: EXPIRES_IN });
}

export function verifyJwt(token: string): JwtPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET);
  if (
    typeof decoded !== "object" ||
    decoded === null ||
    typeof (decoded as JwtPayload).userId !== "string" ||
    typeof (decoded as JwtPayload).merchantId !== "string" ||
    !ROLES.has((decoded as JwtPayload).role)
  ) {
    throw new Error("invalid jwt payload");
  }
  return decoded as JwtPayload;
}
