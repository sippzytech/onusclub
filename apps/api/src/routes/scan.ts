import { Router, type Request, type Response } from "express";
import { ScanInput, euroToCents, type ScanResult } from "@onusclub/shared";
import { authContext, requireAuth } from "../auth/middleware.js";
import { ApiError } from "../errors.js";
import {
  addPointsToCard,
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

    // ----- Points cards -----
    if (found.kind === "points") {
      // 'auto' on a points card always means "the UI needs to collect the
      // bill amount first" — return a needs_amount payload instead of
      // mutating. The merchant types €X, the UI POSTs back with
      // action='add-points' and amount.
      if (input.action === "auto") {
        return res.json({
          status: "needs_amount",
          cardId: found.id,
          programType: "points",
          customerName: found.customerName,
          programName: found.programName,
          rewardText: found.rewardText,
          currentBalance: found.pointsCurrent,
          pointsForReward: found.pointsForReward,
          pointsPerEuro: found.pointsPerEuro,
          eligibleToRedeem:
            found.pointsForReward > 0 &&
            found.pointsCurrent >= found.pointsForReward,
        });
      }
      if (input.action === "add-points") {
        if (typeof input.amount !== "number" || input.amount <= 0) {
          throw ApiError.badRequest(
            "amount is required when action='add-points'"
          );
        }
        const detail = await addPointsToCard(found.id, ctx.merchantId, input.amount);
        return res.json({ status: "applied", detail, appliedAction: "add-points" });
      }
      if (input.action === "redeem") {
        const detail = await redeemCardById(
          found.id,
          ctx.merchantId,
          input.amount === undefined ? null : euroToCents(input.amount)
        );
        return res.json({ status: "applied", detail, appliedAction: "redeem" });
      }
      // action='stamp' on a points card — nonsensical, reject clearly.
      throw ApiError.badRequest(
        "action 'stamp' is not valid for a points card; use 'add-points' instead"
      );
    }

    // ----- Stamp cards (existing behavior, unchanged) -----
    let applied: "stamp" | "redeem";
    if (input.action === "auto") {
      applied = found.stampsCurrent >= found.stampsRequired ? "redeem" : "stamp";
    } else if (input.action === "stamp" || input.action === "redeem") {
      applied = input.action;
    } else {
      throw ApiError.badRequest(
        `action '${input.action}' is not valid for a stamp card`
      );
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

    // The sale amount is optional here and never gates the stamp. In practice
    // the scanner UI attaches it afterwards (see PATCH .../events/:id/amount)
    // so the once-per-day rule can answer before staff type anything — but
    // accepting it up front keeps the endpoint usable by any other client.
    const amountCents = input.amount === undefined ? null : euroToCents(input.amount);

    const detail =
      applied === "stamp"
        ? await stampCardById(found.id, ctx.merchantId, amountCents)
        : await redeemCardById(found.id, ctx.merchantId, amountCents);

    return res.json({ status: "applied", detail, appliedAction: applied });
  }
);
