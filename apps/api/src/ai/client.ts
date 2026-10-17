/**
 * The Anthropic call behind AI campaign drafts.
 *
 * Claude writes copy here; it never sends anything. The result fills the
 * broadcast composer the merchant is already looking at, and the Send button
 * is untouched — the only thing between a generated sentence and a real
 * customer's lock screen is a human pressing it.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { ResultSetHeader } from "mysql2";
import {
  CampaignDraft,
  CAMPAIGN_DRAFT_COUNT,
  type CampaignDraft as CampaignDraftType,
} from "@onusclub/shared";
import { env } from "../config.js";
import { pool } from "../db/pool.js";
import { logger } from "../logger.js";
import {
  buildDraftPrompt,
  DRAFT_OUTPUT_SCHEMA,
  DRAFT_SYSTEM_PROMPT,
  type DraftContext,
} from "./prompt.js";

/**
 * Pinned, and recorded on every ai_drafts row.
 *
 * Changing this is a cost change and a quality change at once, so it is a
 * named constant in one place rather than a string inside the request — and
 * old ledger rows stay interpretable because they carry the model they used.
 */
export const DRAFT_MODEL = "claude-opus-5-5";

/**
 * Low effort, deliberately.
 *
 * This is copywriting inside a 200-character ceiling, not reasoning. Higher
 * effort costs more, takes longer, and produces no better push notification.
 * Thinking cannot be switched off on this model and should not be — omitting
 * the parameter runs it adaptively, which is the right default.
 */
const DRAFT_EFFORT = "low" as const;

/** Three short options. 2000 is generous enough that nothing truncates. */
const DRAFT_MAX_TOKENS = 2000;

export function aiConfigured(): boolean {
  return env.ANTHROPIC_API_KEY !== "";
}

/**
 * Created lazily rather than at module load.
 *
 * The SDK constructor throws when no key is resolvable, and this module is
 * imported by the routes file, which is imported by index.ts — so constructing
 * eagerly would turn "no key configured" into "the api will not boot". That is
 * the opposite of how every other optional integration here behaves.
 */
let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return client;
}

export interface DraftResult {
  drafts: CampaignDraftType[];
}

/**
 * Record what the call cost.
 *
 * Inside this function rather than at the call site, for the reason
 * `email_deliveries` is written inside `sendEmail`: there will eventually be a
 * second caller, and "remember to log it" is the instruction that gets missed
 * on the second one.
 *
 * Swallows its own errors. A draft that was generated must not surface as a
 * failure because the meter row could not be written — and must not 500 on a
 * box where migration 015 has not run yet.
 */
async function record(
  merchantId: string,
  ctx: DraftContext,
  usage: { input_tokens: number; output_tokens: number },
  draftsKept: number
): Promise<void> {
  try {
    await pool.execute<ResultSetHeader>(
      `INSERT INTO ai_drafts
         (merchant_id, rfm_segment, language, model, input_tokens, output_tokens, drafts_kept)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        merchantId,
        ctx.segment ?? null,
        ctx.language,
        DRAFT_MODEL,
        usage.input_tokens,
        usage.output_tokens,
        draftsKept,
      ]
    );
  } catch (err) {
    logger.error({ err, merchantId }, "could not record ai draft usage");
  }
}

/**
 * Pull the structured JSON out of the response.
 *
 * With `output_config.format` set, the model's answer arrives as a single text
 * block whose content is the JSON document. Other block types (thinking) may
 * be present and are skipped.
 */
function jsonTextOf(message: Anthropic.Message): string | null {
  for (const block of message.content) {
    if (block.type === "text") return block.text;
  }
  return null;
}

export class DraftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftError";
  }
}

export async function generateDrafts(
  merchantId: string,
  ctx: DraftContext
): Promise<DraftResult> {
  const message = await anthropic().messages.create({
    model: DRAFT_MODEL,
    max_tokens: DRAFT_MAX_TOKENS,
    system: DRAFT_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildDraftPrompt(ctx) }],
    output_config: {
      effort: DRAFT_EFFORT,
      format: { type: "json_schema", schema: DRAFT_OUTPUT_SCHEMA },
    },
  });

  // Safety classifiers can decline (HTTP 200, stop_reason 'refusal'), and a
  // hit max_tokens leaves truncated JSON. Both must be checked before the
  // content is read, or the parse failure gets reported as a model bug.
  if (message.stop_reason === "refusal") {
    logger.warn(
      { merchantId, category: message.stop_details?.category },
      "draft request was declined"
    );
    throw new DraftError("the model declined this request — try rewording the occasion");
  }
  if (message.stop_reason === "max_tokens") {
    throw new DraftError("the model ran out of room — try a shorter occasion");
  }

  const text = jsonTextOf(message);
  if (!text) throw new DraftError("the model returned no text");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new DraftError("the model returned malformed JSON");
  }

  const raw = (parsed as { drafts?: unknown }).drafts;
  const candidates = Array.isArray(raw) ? raw : [];

  // Validate each option against the SAME schema the composer posts back, and
  // DROP the ones that fail. Not truncate: a body cut off at 200 characters
  // mid-sentence is worse than two options instead of three, and silently
  // trimming would hide a prompt that had drifted out of agreement with the
  // limits. `drafts_kept` in the ledger is what surfaces that drift.
  const drafts: CampaignDraftType[] = [];
  for (const candidate of candidates.slice(0, CAMPAIGN_DRAFT_COUNT)) {
    const result = CampaignDraft.safeParse(candidate);
    if (result.success) {
      drafts.push(result.data);
    } else {
      logger.warn(
        { merchantId, issues: result.error.issues.map((i) => i.message) },
        "discarded an over-long or malformed draft"
      );
    }
  }

  // Metered even when every option was discarded — the tokens were spent
  // either way, and a run of drafts_kept = 0 is the signal worth having.
  await record(merchantId, ctx, message.usage, drafts.length);

  if (drafts.length === 0) {
    throw new DraftError("the model's suggestions were all too long — try again");
  }

  return { drafts };
}
