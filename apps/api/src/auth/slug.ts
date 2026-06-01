import { randomBytes } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool.js";

// Avoid lookalike characters (0/o, 1/l/i) so the suffix is readable when
// printed on a counter sign and isn't easy to mistype when shared verbally.
const SUFFIX_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const SUFFIX_LEN = 5;

function kebabCase(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    // strip combining diacritics
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function randomSuffix(): string {
  const bytes = randomBytes(SUFFIX_LEN);
  let s = "";
  for (let i = 0; i < SUFFIX_LEN; i++) {
    s += SUFFIX_ALPHABET[bytes[i] % SUFFIX_ALPHABET.length];
  }
  return s;
}

interface CountRow extends RowDataPacket {
  c: number;
}

/**
 * Generate a unique public slug for a merchant: `<kebab-business-name>-<5
 * random chars>`. Retries on collision (very unlikely — base 32^5 ≈ 33M
 * possibilities per prefix).
 */
export async function generateUniqueSlug(businessName: string): Promise<string> {
  const prefix = kebabCase(businessName) || "merchant";
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = `${prefix}-${randomSuffix()}`;
    const [rows] = await pool.execute<CountRow[]>(
      "SELECT COUNT(*) AS c FROM merchants WHERE public_slug = ?",
      [candidate]
    );
    if (rows[0].c === 0) return candidate;
  }
  throw new Error("could not generate a unique public slug after 8 attempts");
}
