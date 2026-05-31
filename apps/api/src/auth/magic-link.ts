import { randomBytes } from "node:crypto";
import { pool } from "../db/pool.js";
import { env } from "../config.js";
import { logger } from "../logger.js";

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface MagicLinkIssued {
  token: string;
  url: string;
  expiresAt: Date;
}

export async function issueMagicLink(userId: string): Promise<MagicLinkIssued> {
  const token = randomBytes(32).toString("hex"); // 64 chars
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  await pool.execute(
    "INSERT INTO auth_tokens (token, user_id, expires_at, used) VALUES (?, ?, ?, FALSE)",
    [token, userId, expiresAt]
  );

  const url = `${env.BASE_URL_WEB}/auth/verify?token=${token}`;

  // Stand-in for SMTP. The web app also surfaces this in dev so testing is one click.
  logger.info({ userId, url }, "magic link issued");

  return { token, url, expiresAt };
}
