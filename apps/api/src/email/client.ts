import { env } from "../config.js";
import { logger } from "../logger.js";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendEmailResult {
  ok: boolean;
  delivered: boolean; // true when Resend accepted it, false when we only logged
  id?: string;
  error?: string;
}

const RESEND_URL = "https://api.resend.com/emails";

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  if (!env.RESEND_API_KEY) {
    logger.info(
      { to: input.to, subject: input.subject, preview: input.text.slice(0, 200) },
      "email (dev mode — no RESEND_API_KEY): would have sent"
    );
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
      return { ok: false, delivered: false, error: msg };
    }
    logger.info({ to: input.to, id: data.id, subject: input.subject }, "email sent");
    return { ok: true, delivered: true, id: data.id };
  } catch (err) {
    const msg = (err as Error).message;
    logger.error({ to: input.to, err: msg }, "email request threw");
    return { ok: false, delivered: false, error: msg };
  }
}
