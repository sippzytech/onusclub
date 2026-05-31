import jwt from "jsonwebtoken";
import { env } from "../config.js";

export interface JwtPayload {
  userId: string;
  merchantId: string;
  role: "owner" | "staff";
}

const EXPIRES_IN = "7d";

export function signJwt(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: EXPIRES_IN });
}

export function verifyJwt(token: string): JwtPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET);
  if (
    typeof decoded !== "object" ||
    decoded === null ||
    typeof (decoded as JwtPayload).userId !== "string" ||
    typeof (decoded as JwtPayload).merchantId !== "string"
  ) {
    throw new Error("invalid jwt payload");
  }
  return decoded as JwtPayload;
}
