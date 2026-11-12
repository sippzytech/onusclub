/**
 * Platform settings — a small key/value store, read and written only from
 * `/v1/admin`.
 *
 * Deliberately not a column-per-setting table: the next three settings would
 * each be a schema change. This is configuration, not a domain model.
 */
import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { logger } from "../logger.js";

export const DELETE_CODE_KEY = "delete_confirmation_code";

interface SettingRow extends RowDataPacket {
  setting_value: string;
}

async function readSetting(key: string): Promise<string | null> {
  const [rows] = await pool.execute<SettingRow[]>(
    "SELECT setting_value FROM platform_settings WHERE setting_key = ? LIMIT 1",
    [key]
  );
  return rows[0]?.setting_value ?? null;
}

/**
 * Does `code` match the stored café-deletion code?
 *
 * Stored bcrypt-hashed, exactly like a password, and compared with the same
 * helpers — so a read of `platform_settings` does not hand someone the one
 * thing standing between a misclick and an irreversible cascade.
 *
 * ⚠️ Fails CLOSED. A missing row means something is wrong with the install,
 * and the safe reading of "I cannot tell whether this code is right" is no,
 * not yes — this gates a delete.
 */
export async function deleteCodeMatches(code: string): Promise<boolean> {
  const stored = await readSetting(DELETE_CODE_KEY);
  if (!stored) {
    logger.error(
      { key: DELETE_CODE_KEY },
      "no deletion code configured — refusing every café deletion until there is one"
    );
    return false;
  }
  return verifyPassword(code, stored);
}

/** Change the code. Stored hashed; the plaintext is never written anywhere. */
export async function setDeleteCode(code: string): Promise<void> {
  const hash = await hashPassword(code);
  await pool.execute(
    `INSERT INTO platform_settings (setting_key, setting_value)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [DELETE_CODE_KEY, hash]
  );
  // Deliberately logs that it changed and not to what.
  logger.warn({ key: DELETE_CODE_KEY }, "café-deletion code changed");
}
