// One card, with its full event history — the view a support question
// actually lands on, and (from commit 4) where a balance gets corrected.

import { Router, type Request, type Response } from "express";
import type { RowDataPacket } from "mysql2";
import { AdminAdjustInput, type AdminAdjustResult, type AdminCardView } from "@onusclub/shared";
import { pool } from "../../db/pool.js";
import { ApiError } from "../../errors.js";
import { applyManualAdjust, getCardDetail } from "../../cards/operations.js";
import { adminContext } from "../../admin/authorize.js";

export const adminCardsRouter: Router = Router();

interface OwnerRow extends RowDataPacket {
  merchant_id: string;
  merchant_name: string;
  customer_id: string;
}

/**
 * Which café owns a card.
 *
 * Every card operation in the codebase takes a `merchantId` and filters on it.
 * Rather than adding unscoped variants of those functions — which would then
 * exist, ready to be called from a merchant-facing route by mistake — the
 * admin path looks up the owning merchant first and then calls the ordinary
 * scoped function with it. The tenant predicate stays in place; this route
 * just supplies the tenant.
 */
export async function ownerOfCard(cardId: string): Promise<OwnerRow> {
  const [rows] = await pool.execute<OwnerRow[]>(
    `SELECT c.merchant_id, c.customer_id, m.business_name AS merchant_name
       FROM loyalty_cards c
       JOIN merchants m ON m.id = c.merchant_id
      WHERE c.id = ?
      LIMIT 1`,
    [cardId]
  );
  if (rows.length === 0) throw ApiError.notFound("card not found");
  return rows[0];
}

interface BalanceRow extends RowDataPacket {
  balance: string | number | null;
}

/**
 * The authoritative points balance for a card, from the batch ledger.
 *
 * ⚠️ Not `card_state.points_current`. That column is a cache of this sum which
 * `computePointsBalance` rewrites on every transaction, so a drifted value
 * there would be displayed as fact on the one screen used to answer "my
 * customer says their points are wrong".
 *
 * Mirrors computePointsBalance in cards/operations.ts, which is private to
 * that module and takes a transaction connection. If the expiry rule there
 * changes, change it here too.
 */
export async function ledgerPointsBalance(cardId: string): Promise<number> {
  const [rows] = await pool.execute<BalanceRow[]>(
    `SELECT COALESCE(SUM(points_remaining), 0) AS balance
       FROM points_batches
      WHERE card_id = ?
        AND points_remaining > 0
        AND (expires_at IS NULL OR expires_at > NOW())`,
    [cardId]
  );
  return Number(rows[0]?.balance ?? 0);
}

/**
 * POST /v1/admin/cards/:id/adjust
 *
 * The one write the master dashboard makes to a café's data. All the care
 * lives in `applyManualAdjust` — the batch-ledger handling, the range checks,
 * the two audit rows inside one transaction. This route validates and
 * attributes.
 */
adminCardsRouter.post("/:id/adjust", async (req: Request, res: Response<AdminAdjustResult>) => {
  const actor = adminContext(req);
  const input = AdminAdjustInput.parse(req.body);
  const result = await applyManualAdjust(req.params.id, input.delta, input.reason, actor);
  return res.json({
    unit: result.unit,
    before: result.before,
    after: result.after,
    detail: result.detail,
  });
});

adminCardsRouter.get("/:id", async (req: Request, res: Response<AdminCardView>) => {
  const owner = await ownerOfCard(req.params.id);
  const detail = await getCardDetail(req.params.id, owner.merchant_id);

  const isPoints = detail.card.programType === "points";
  const pointsBalance = isPoints ? await ledgerPointsBalance(req.params.id) : null;
  const cached = isPoints
    ? (detail.card.cardState as { points_current?: number }).points_current
    : undefined;

  return res.json({
    merchantId: owner.merchant_id,
    merchantName: owner.merchant_name,
    customerId: owner.customer_id,
    detail,
    pointsBalance,
    pointsCacheStale: pointsBalance !== null && cached !== pointsBalance,
  });
});
