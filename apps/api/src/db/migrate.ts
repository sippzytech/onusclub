import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import mysql from "mysql2/promise";
import { env } from "../config.js";
import { logger } from "../logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "migrations");

async function run(): Promise<void> {
  const conn = await mysql.createConnection({
    uri: env.DATABASE_URL,
    multipleStatements: true,
  });

  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith(".sql"))
      .sort();

    const [appliedRows] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT name FROM _migrations"
    );
    const applied = new Set(appliedRows.map((r) => r.name as string));

    let appliedCount = 0;
    for (const file of files) {
      if (applied.has(file)) {
        logger.debug({ file }, "skip (already applied)");
        continue;
      }
      const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
      logger.info({ file }, "applying migration");
      await conn.query(sql);
      await conn.query("INSERT INTO _migrations (name) VALUES (?)", [file]);
      appliedCount += 1;
    }

    logger.info({ applied: appliedCount, total: files.length }, "migrations done");
  } finally {
    await conn.end();
  }
}

run().catch((err) => {
  logger.error({ err }, "migration failed");
  process.exit(1);
});
