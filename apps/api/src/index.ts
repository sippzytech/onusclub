import express, { type Request, type Response } from "express";
import { pinoHttp } from "pino-http";
import type { HealthResponse } from "@stampdeck/shared";
import { env, SERVICE_NAME, SERVICE_VERSION } from "./config.js";
import { logger } from "./logger.js";
import { ensureDbConnection, pool } from "./db/pool.js";

const app = express();

app.use(pinoHttp({ logger }));
app.use(express.json());

app.get("/health", (_req: Request, res: Response<HealthResponse>) => {
  res.json({ ok: true, service: SERVICE_NAME, version: SERVICE_VERSION });
});

async function main(): Promise<void> {
  await ensureDbConnection();

  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, "api listening");
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "shutting down");
    server.close();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error({ err }, "api failed to start");
  process.exit(1);
});
