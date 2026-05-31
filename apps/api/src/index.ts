import express, { type Request, type Response } from "express";
import { pinoHttp } from "pino-http";
import "express-async-errors";
import type { HealthResponse } from "@stampdeck/shared";
import { env, SERVICE_NAME, SERVICE_VERSION } from "./config.js";
import { logger } from "./logger.js";
import { ensureDbConnection, pool } from "./db/pool.js";
import { errorHandler } from "./errors.js";
import { authRouter } from "./routes/auth.js";
import { cardsRouter } from "./routes/cards.js";
import { customersRouter } from "./routes/customers.js";
import { merchantsRouter } from "./routes/merchants.js";
import { meRouter } from "./routes/me.js";
import { programsRouter } from "./routes/programs.js";

const app = express();

app.use(pinoHttp({ logger }));
app.use(express.json());

app.get("/health", (_req: Request, res: Response<HealthResponse>) => {
  res.json({ ok: true, service: SERVICE_NAME, version: SERVICE_VERSION });
});

app.use("/v1/auth", authRouter);
app.use("/v1/merchants", merchantsRouter);
app.use("/v1/me", meRouter);
app.use("/v1/programs", programsRouter);
app.use("/v1/customers", customersRouter);
app.use("/v1/cards", cardsRouter);

app.use(errorHandler);

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
