// Platform admin API.
//
// Every query under this directory deliberately omits `merchant_id` — which is
// the exact opposite of the rule the other ~53 queries in this codebase
// follow. That is why these routes live in their own directory: "where is
// tenant scoping bypassed?" should be answerable with `ls`.
//
// Nothing here applies `requireAuth` or `requirePlatformAdmin` itself. Both
// are applied once, to the mount, in src/index.ts. Adding a route to this
// router cannot accidentally ship it ungated.

import { Router, type Request, type Response } from "express";
import type { AdminWhoami } from "@onusclub/shared";
import { adminContext } from "../../admin/authorize.js";
import { adminAuditRouter } from "./audit.js";
import { adminCardsRouter } from "./cards.js";
import { adminCustomersRouter } from "./customers.js";
import { adminMerchantsRouter } from "./merchants.js";
import { adminMetricsRouter } from "./metrics.js";

export const adminRouter: Router = Router();

/**
 * GET /v1/admin/whoami
 *
 * Does double duty: it is the dashboard's "am I allowed in here" probe (the
 * web layer calls it and renders a 404 page if it fails), and it is the
 * cheapest possible thing for the smoke suite to assert both the grant and
 * the revoke against.
 */
adminRouter.get("/whoami", (req: Request, res: Response<AdminWhoami>) => {
  const actor = adminContext(req);
  return res.json({
    userId: actor.userId,
    email: actor.email,
    merchantId: actor.merchantId,
  });
});

adminRouter.use("/merchants", adminMerchantsRouter);
adminRouter.use("/metrics", adminMetricsRouter);
adminRouter.use("/customers", adminCustomersRouter);
adminRouter.use("/cards", adminCardsRouter);
adminRouter.use("/audit", adminAuditRouter);
