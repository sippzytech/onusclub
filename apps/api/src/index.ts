import express, { type Request, type Response } from "express";
import { pinoHttp } from "pino-http";
import "express-async-errors";
import type { HealthResponse } from "@onusclub/shared";
import { env, SERVICE_NAME, SERVICE_VERSION } from "./config.js";
import { logger } from "./logger.js";
import { ensureDbConnection, pool } from "./db/pool.js";
import { errorHandler } from "./errors.js";
import { analyticsRouter } from "./routes/analytics.js";
import { authRouter } from "./routes/auth.js";
import { broadcastsRouter } from "./routes/broadcasts.js";
import { cardsRouter } from "./routes/cards.js";
import { customersRouter } from "./routes/customers.js";
import { merchantsRouter } from "./routes/merchants.js";
import { meRouter } from "./routes/me.js";
import { messagesRouter } from "./routes/messages.js";
import { programsRouter } from "./routes/programs.js";
import { leadsRouter } from "./routes/leads.js";
import { locationsRouter } from "./routes/locations.js";
import { publicRouter } from "./routes/public.js";
import { scanRouter } from "./routes/scan.js";
import { staffRouter } from "./routes/staff.js";
import { sweepsRouter } from "./routes/sweeps.js";
import { walletRouter } from "./routes/wallet.js";
import { appleWalletRouter } from "./routes/apple-wallet.js";
import { adminRouter } from "./routes/admin/index.js";
import { requireAuth } from "./auth/middleware.js";
import { requirePlatformAdmin } from "./admin/authorize.js";
import { startMessagingCrons } from "./messaging/cron.js";

const app = express();

/**
 * Response headers, hand-rolled rather than via helmet.
 *
 * This API serves JSON and two binary endpoints (a .pkpass and a logo); it
 * renders no HTML, so most of helmet's defaults are inert here and a
 * dependency to carry them is not worth it. These four are the ones that do
 * something:
 *
 *  - nosniff stops a browser treating a JSON error body as HTML/script, which
 *    is the one XSS-adjacent risk a JSON API has.
 *  - DENY framing: nothing here is meant to be embedded, and the customer card
 *    page lives on the web origin, not this one.
 *  - no-referrer: the customer card URL carries `qr_token` as a bearer
 *    credential in the path, so the Referer header must never carry it to a
 *    third party. Modern browsers default to strict-origin-when-cross-origin,
 *    which would already strip the path — this makes it explicit rather than
 *    dependent on a default.
 *  - HSTS in production only. Setting it in dev would pin localhost to HTTPS
 *    in the developer's browser, which is a genuinely annoying thing to undo.
 *    Traefik terminates TLS, so this is the only place it can be set.
 */
app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});

app.use(pinoHttp({ logger }));
// CSV import posts the whole file as a JSON string, and express.json defaults
// to a 100 kb limit — about 1,500 customer rows. A café migrating from another
// system can easily exceed that, and the failure is an opaque 413. Mounted
// before the global parser; body-parser marks the request as parsed, so the
// general one below skips it rather than parsing twice.
app.use("/v1/customers/import", express.json({ limit: "5mb" }));
// Logo upload posts base64 image bytes, which inflate by about a third.
app.use("/v1/me/branding", express.json({ limit: "5mb" }));
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
app.use("/v1/scan", scanRouter);
app.use("/v1/analytics", analyticsRouter);
app.use("/v1/broadcasts", broadcastsRouter);
app.use("/v1/sweeps", sweepsRouter);
app.use("/v1/messages", messagesRouter);
app.use("/v1/public/leads", leadsRouter);
app.use("/v1/public", publicRouter);
app.use("/v1/staff", staffRouter);
app.use("/v1/locations", locationsRouter);
app.use("/v1", walletRouter);
app.use("/v1/apple-wallet", appleWalletRouter);

// Platform admin — the one router that reads across tenants.
//
// Authorization is applied HERE, to the mount, and deliberately not per route
// the way every other router in this file does it. The asymmetry is the point:
// forgetting `requireAuth` on a normal route exposes one tenant to one tenant,
// while forgetting it on an admin route exposes every café on the platform to
// anyone with a login. Mounting the gate once means a new admin endpoint
// cannot be written ungated.
//
// requirePlatformAdmin answers 404 rather than 403 — see admin/authorize.ts.
app.use("/v1/admin", requireAuth, requirePlatformAdmin, adminRouter);

app.use(errorHandler);

async function main(): Promise<void> {
  await ensureDbConnection();
  startMessagingCrons();

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
