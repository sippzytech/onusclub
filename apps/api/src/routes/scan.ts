import { Router, type Request, type Response } from "express";
import { ScanInput, type ScanResult } from "@stampdeck/shared";
import { authContext, requireAuth } from "../auth/middleware.js";
import { ApiError } from "../errors.js";
import {
  findCardByQrToken,
  redeemCardById,
  stampCardById,
} from "../cards/operations.js";

export const scanRouter: Router = Router();

scanRouter.post(
  "/",
  requireAuth,
  async (req: Request, res: Response<ScanResult>) => {
    const ctx = authContext(req);
    const input = ScanInput.parse(req.body);

    const found = await findCardByQrToken(input.qrToken, ctx.merchantId);
    if (!found) throw ApiError.notFound("no active card for that code");

    let applied: "stamp" | "redeem";
    if (input.action === "auto") {
      applied = found.stampsCurrent >= found.stampsRequired ? "redeem" : "stamp";
    } else {
      applied = input.action;
    }

    // One-stamp-per-day rule: prevents accidental double-stamping when the
    // camera fires twice in a row AND deliberate-but-shady same-day rescans.
    // Redeems are NOT day-capped — owners may need to redeem on the same
    // day as a stamp that pushed the card past threshold.
    if (applied === "stamp" && found.stampedToday) {
      throw new ApiError(
        409,
        "already_stamped_today",
        "This card was already stamped today — try again tomorrow."
      );
    }

    const detail =
      applied === "stamp"
        ? await stampCardById(found.id, ctx.merchantId)
        : await redeemCardById(found.id, ctx.merchantId);

    return res.json({ detail, appliedAction: applied });
  }
);
