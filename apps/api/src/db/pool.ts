import mysql from "mysql2/promise";
import { env } from "../config.js";
import { logger } from "../logger.js";

export const pool = mysql.createPool({
  uri: env.DATABASE_URL,
  waitForConnections: true,
  connectionLimit: 10,
  enableKeepAlive: true,
  multipleStatements: false,
  // Interpret DATETIME/TIMESTAMP as UTC explicitly. mysql2 otherwise defaults
  // to 'local', meaning the Node process's zone — which is UTC here only
  // because neither compose file sets TZ and Alpine defaults to it. Set TZ on
  // a container someday and every timestamp would silently shift, taking the
  // analytics day/hour bucketing with it. This makes it a decision rather than
  // a coincidence.
  timezone: "Z",
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
