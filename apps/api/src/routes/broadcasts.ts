import { Router, type Request, type Response } from "express";
import type { RowDataPacket } from "mysql2";
import {
  BroadcastCreateInput,
  CampaignDraftInput,
  type Broadcast,
  type CampaignDraftResponse,
  type DraftLanguage,
  type MessageDelivery,
} from "@onusclub/shared";
import { pool } from "../db/pool.js";
import { authContext, requireAuth } from "../auth/middleware.js";
import { aiConfigured, DraftError, generateDrafts } from "../ai/client.js";
import type { DraftContext } from "../ai/prompt.js";
import { ApiError } from "../errors.js";
import { aiDraftLimiter } from "../http/rate-limit.js";
import {
  customerIdsInSegment,
  retrySource,
  startBroadcast,
} from "../messaging/operations.js";

export const broadcastsRouter: Router = Router();

interface BroadcastRow extends RowDataPacket {
  id: string;
  merchant_id: string;
  header: string;
  body: string;
  audience_filter: unknown;
  status: Broadcast["status"];
  scanned: number;
  sent: number;
  failed: number;
  started_at: Date;
  finished_at: Date | null;
}

interface DeliveryRow extends RowDataPacket {
  id: number;
  source_type: MessageDelivery["sourceType"];
  source_id: string;
  merchant_id: string;
  card_id: string;
  customer_id: string;
  customer_name: string | null;
  program_name: string;
  status: MessageDelivery["status"];
  attempts: number;
  last_error: string | null;
  last_attempt_at: Date | null;
  created_at: Date;
}

function rowToBroadcast(row: BroadcastRow): Broadcast {
  const filter =
    row.audience_filter === null || row.audience_filter === undefined
      ? null
      : typeof row.audience_filter === "string"
      ? (JSON.parse(row.audience_filter) as Broadcast["audienceFilter"])
      : (row.audience_filter as Broadcast["audienceFilter"]);
  return {
    id: row.id,
    merchantId: row.merchant_id,
    header: row.header,
    body: row.body,
    audienceFilter: filter,
    status: row.status,
    scanned: row.scanned,
    sent: row.sent,
    failed: row.failed,
    startedAt: new Date(row.started_at).toISOString(),
    finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : null,
  };
}

function rowToDelivery(row: DeliveryRow): MessageDelivery {
  return {
    id: row.id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    merchantId: row.merchant_id,
    cardId: row.card_id,
    customerId: row.customer_id,
    customerName: row.customer_name,
    programName: row.program_name,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    lastAttemptAt: row.last_attempt_at ? new Date(row.last_attempt_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

interface PremiumRow extends RowDataPacket {
  is_premium: number;
}

async function requirePremium(merchantId: string): Promise<void> {
  const [rows] = await pool.execute<PremiumRow[]>(
    "SELECT is_premium FROM merchants WHERE id = ? LIMIT 1",
    [merchantId]
  );
  if (rows.length === 0 || !rows[0].is_premium) {
    throw new ApiError(
      402,
      "premium_required",
      "messaging is a premium feature — unlock to use"
    );
  }
}

// POST /v1/broadcasts — fire a broadcast (async). Premium-only.
broadcastsRouter.post(
  "/",
  requireAuth,
  async (req: Request, res: Response<{ broadcastId: string }>) => {
    const ctx = authContext(req);
    await requirePremium(ctx.merchantId);
    const input = BroadcastCreateInput.parse(req.body);
    const id = await startBroadcast(
      ctx.merchantId,
      input.header,
      input.body,
      input.audienceFilter
    );
    return res.status(202).json({ broadcastId: id });
  }
);

// ---------------------------------------------------------------------------
// POST /v1/broadcasts/drafts — Claude writes the copy (Day 28)
//
// Returns suggestions only. There is deliberately no path from here to a sent
// broadcast: the response fills the composer's two inputs and the merchant
// presses Send, exactly as they do when they write it themselves.
//
// Registered before `/:id` for readability only — `/:id` is a GET and this is
// a POST, so they could not collide in any order.
// ---------------------------------------------------------------------------

interface DraftMerchantRow extends RowDataPacket {
  business_name: string;
  country: string | null;
}

interface DraftProgramRow extends RowDataPacket {
  program_type: "stamp" | "points";
  reward_text: string;
}

broadcastsRouter.post(
  "/drafts",
  requireAuth,
  // After requireAuth, because it keys on the merchant rather than the
  // address — see the note on aiDraftLimiter.
  aiDraftLimiter,
  async (req: Request, res: Response<CampaignDraftResponse>) => {
    const ctx = authContext(req);
    // Premium first, so a café that cannot send broadcasts is told that rather
    // than being told the AI is unavailable — and so a non-paying account
    // cannot spend our tokens even when a key IS configured.
    await requirePremium(ctx.merchantId);

    // ⚠️ The order of the next three steps is deliberate, and each step is
    // here rather than later for a specific reason:
    //
    //   1. Validate the input. A bad `language` has to answer 400, not the
    //      503 below — otherwise a client bug reads as "the feature is off".
    //   2. Resolve the merchant and the program, tenant-scoped. This runs
    //      before the key check purely so cross-tenant isolation stays
    //      observable with no key configured: the smoke suite can prove
    //      another café's programId does not resolve without spending money
    //      on a model call. Two indexed SELECTs for a feature that may be
    //      switched off is a cheap price for a test that runs on every PR.
    //   3. Only then check the key, and 503 if absent.
    const input = CampaignDraftInput.parse(req.body);

    const [merchantRows] = await pool.execute<DraftMerchantRow[]>(
      "SELECT business_name, country FROM merchants WHERE id = ? LIMIT 1",
      [ctx.merchantId]
    );
    if (merchantRows.length === 0) throw ApiError.notFound("merchant not found");

    // Dutch unless the merchant asked otherwise or is not in NL. The rule
    // lives here rather than in the client so the dashboard never has to know
    // it, and so a merchant who picks English gets English regardless.
    const language: DraftLanguage =
      input.language ?? (merchantRows[0].country === "NL" ? "nl" : "en");

    // Tenant-scoped, like every other id-taking read. A programId belonging to
    // another café does not resolve, and the answer is 404 rather than a draft
    // written without reward wording — a silently-ignored id would hand a
    // merchant vaguer copy with no indication why.
    let program: DraftProgramRow | null = null;
    if (input.programId) {
      const [programRows] = await pool.execute<DraftProgramRow[]>(
        `SELECT program_type, reward_text
           FROM loyalty_programs
          WHERE id = ? AND merchant_id = ?
          LIMIT 1`,
        [input.programId, ctx.merchantId]
      );
      if (programRows.length === 0) throw ApiError.notFound("program not found");
      program = programRows[0];
    }

    if (!aiConfigured()) {
      throw new ApiError(
        503,
        "ai_not_configured",
        "AI drafting is not switched on for this deployment"
      );
    }

    // The same function the broadcast itself will use to pick recipients, so
    // the number in the prompt is the number that will actually be reached.
    const audienceCount = input.rfmSegment
      ? (await customerIdsInSegment(ctx.merchantId, input.rfmSegment)).length
      : null;

    const draftContext: DraftContext = {
      businessName: merchantRows[0].business_name,
      rewardText: program?.reward_text ?? null,
      programType: program?.program_type ?? null,
      segment: input.rfmSegment ?? null,
      audienceCount,
      occasion: input.occasion?.trim() ? input.occasion.trim() : null,
      language,
    };

    try {
      const { drafts } = await generateDrafts(ctx.merchantId, draftContext);
      return res.json({ drafts, language, audienceCount });
    } catch (err) {
      // A DraftError is a known, explainable outcome — the model declined, ran
      // out of room, or every option broke the character limits. 502 with the
      // plain reason, rather than letting it fall through to the generic 500
      // handler and reach the merchant as "unexpected error".
      if (err instanceof DraftError) {
        throw new ApiError(502, "draft_failed", err.message);
      }
      throw err;
    }
  }
);

// GET /v1/broadcasts — list this merchant's broadcasts (most recent first).
broadcastsRouter.get(
  "/",
  requireAuth,
  async (req: Request, res: Response<{ broadcasts: Broadcast[] }>) => {
    const ctx = authContext(req);
    const [rows] = await pool.execute<BroadcastRow[]>(
      `SELECT id, merchant_id, header, body, audience_filter, status, scanned, sent, failed,
              started_at, finished_at
         FROM broadcasts
        WHERE merchant_id = ?
        ORDER BY started_at DESC
        LIMIT 50`,
      [ctx.merchantId]
    );
    return res.json({ broadcasts: rows.map(rowToBroadcast) });
  }
);

// GET /v1/broadcasts/:id — single broadcast + per-card delivery list.
broadcastsRouter.get(
  "/:id",
  requireAuth,
  async (
    req: Request,
    res: Response<{ broadcast: Broadcast; deliveries: MessageDelivery[] }>
  ) => {
    const ctx = authContext(req);
    const [rows] = await pool.execute<BroadcastRow[]>(
      `SELECT id, merchant_id, header, body, audience_filter, status, scanned, sent, failed,
              started_at, finished_at
         FROM broadcasts
        WHERE id = ? AND merchant_id = ?
        LIMIT 1`,
      [req.params.id, ctx.merchantId]
    );
    if (rows.length === 0) throw ApiError.notFound("broadcast not found");

    const [deliveries] = await pool.execute<DeliveryRow[]>(
      `SELECT md.id, md.source_type, md.source_id, md.merchant_id, md.card_id,
              md.customer_id, md.status, md.attempts, md.last_error,
              md.last_attempt_at, md.created_at,
              cu.name AS customer_name, p.name AS program_name
         FROM message_deliveries md
         JOIN loyalty_cards c ON c.id = md.card_id
         JOIN loyalty_programs p ON p.id = c.program_id
         JOIN customers cu ON cu.id = md.customer_id
        WHERE md.source_type = 'broadcast' AND md.source_id = ?
        ORDER BY md.id ASC`,
      [req.params.id]
    );

    return res.json({
      broadcast: rowToBroadcast(rows[0]),
      deliveries: deliveries.map(rowToDelivery),
    });
  }
);

// POST /v1/broadcasts/:id/retry — re-attempt failed deliveries.
broadcastsRouter.post(
  "/:id/retry",
  requireAuth,
  async (
    req: Request,
    res: Response<{ retried: number; sent: number; failed: number }>
  ) => {
    const ctx = authContext(req);
    const [rows] = await pool.execute<BroadcastRow[]>(
      `SELECT header, body FROM broadcasts WHERE id = ? AND merchant_id = ? LIMIT 1`,
      [req.params.id, ctx.merchantId]
    );
    if (rows.length === 0) throw ApiError.notFound("broadcast not found");
    const result = await retrySource("broadcast", req.params.id, ctx.merchantId, {
      header: rows[0].header,
      body: rows[0].body,
    });
    return res.json(result);
  }
);
