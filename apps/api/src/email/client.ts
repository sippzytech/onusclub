import type { ResultSetHeader } from "mysql2";
import { env } from "../config.js";
import { logger } from "../logger.js";
import { pool } from "../db/pool.js";

/**
 * What an email was for. Required on every send, because the whole point of
 * recording attempts is being able to ask "did the invites go out?" rather
 * than "did any email go out?".
 *
 * A string union rather than a DB enum — adding a kind should not be a
 * migration.
 */
export type EmailKind =
  | "welcome"
  | "card_invite"
  | "magic_link"
  | "password_reset"
  | "admin_password_reset"
  | "lead_notification"
  | "weekly_digest";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Recorded against the send. See EmailKind. */
  kind: EmailKind;
  /** Null for the lead notification, which goes to us and belongs to no tenant. */
  merchantId?: string | null;
  /** Set for card invites, so a café can answer "did my customer get it?". */
  customerId?: string | null;
  cardId?: string | null;
}

export interface SendEmailResult {
  ok: boolean;
  delivered: boolean; // true when Resend accepted it, false when we only logged
  id?: string;
  error?: string;
}

const RESEND_URL = "https://api.resend.com/emails";

/**
 * Record the outcome in `email_deliveries`.
 *
 * Lives inside `sendEmail` rather than at the call sites deliberately: there
 * are six senders spread across auth, cards, wallet, leads and admin, and
 * "remember to log it" is exactly the instruction that gets missed on the
 * seventh. Same principle as writeAuditLog taking the caller's connection.
 *
 * Swallows its own errors. An email that was actually sent must not surface as
 * a failure because the bookkeeping row could not be written — and more
 * importantly, a password reset must not 500 because this table is missing on
 * a box where migration 013 has not run yet.
 */
async function record(
  input: SendEmailInput,
  status: "sent" | "failed" | "skipped",
  extra: { providerId?: string; error?: string }
): Promise<void> {
  try {
    await pool.execute<ResultSetHeader>(
      `INSERT INTO email_deliveries
         (kind, merchant_id, customer_id, card_id, to_email, subject, status, provider_id, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.kind,
        input.merchantId ?? null,
        input.customerId ?? null,
        input.cardId ?? null,
        input.to,
        // The column is 300; a subject longer than that is a bug elsewhere but
        // must not be the thing that throws here.
        input.subject.slice(0, 300),
        status,
        extra.providerId ?? null,
        extra.error ? extra.error.slice(0, 500) : null,
      ]
    );
  } catch (err) {
    logger.error({ err, kind: input.kind, to: input.to }, "could not record email delivery");
  }
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  if (!env.RESEND_API_KEY) {
    logger.info(
      { to: input.to, subject: input.subject, preview: input.text.slice(0, 200) },
      "email (dev mode — no RESEND_API_KEY): would have sent"
    );
    // 'skipped', not 'failed'. Nothing was attempted and nothing is wrong;
    // counting local dev as failures would make the health figures useless.
    await record(input, "skipped", {});
    return { ok: true, delivered: false };
  }

  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      id?: string;
      message?: string;
      name?: string;
    };
    if (!res.ok) {
      const msg = data.message ?? data.name ?? `HTTP ${res.status}`;
      logger.error({ to: input.to, status: res.status, msg }, "email send failed");
      // Status code included: 429 is the daily cap, which is a completely
      // different conversation from a rejected address, and the recorded
      // string is all anyone reading the dashboard will have.
      await record(input, "failed", { error: `${res.status}: ${msg}` });
      return { ok: false, delivered: false, error: msg };
    }
    logger.info({ to: input.to, id: data.id, subject: input.subject }, "email sent");
    await record(input, "sent", { providerId: data.id });
    return { ok: true, delivered: true, id: data.id };
  } catch (err) {
    const msg = (err as Error).message;
    logger.error({ to: input.to, err: msg }, "email request threw");
    await record(input, "failed", { error: msg });
    return { ok: false, delivered: false, error: msg };
  }
}
