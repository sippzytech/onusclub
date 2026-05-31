import mysql from "mysql2/promise";
import { env } from "../config.js";
import { logger } from "../logger.js";

export const pool = mysql.createPool({
  uri: env.DATABASE_URL,
  waitForConnections: true,
  connectionLimit: 10,
  enableKeepAlive: true,
  multipleStatements: false,
});

export async function ensureDbConnection(): Promise<void> {
  const conn = await pool.getConnection();
  try {
    await conn.ping();
    logger.info("MySQL connection OK");
  } finally {
    conn.release();
  }
}
