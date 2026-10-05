// Lead capture from the marketing site (onusclub.com).
//
// ## Why this endpoint is shaped the way it is
//
// The marketing site is a separate Next.js app on a different origin. It calls
// this route **server-side**, from its own /api/leads handler — never from the
// browser. That mirrors the dashboard, whose api client carries the same rule:
// "We always talk to the api from Next.js server code, never from the browser."
//
// Keeping that rule is why there is a shared secret instead of CORS. Opening
// CORS so a browser could post here would weaken the whole api's posture for
// one marketing form, and would make this a genuinely public write endpoint —
// in a codebase with no rate limiting anywhere.

import { createHash, randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { LeadInput, type LeadResult } from "@onusclub/shared";
import { pool } from "../db/pool.js";
import { env } from "../config.js";
import { logger } from "../logger.js";
import { sendEmail } from "../email/client.js";
// Hoisted to src/http/ during the Day 26 review: a second copy in the admin
// tripwire had drifted to plain `req.ip` and was logging the proxy.
import { clientIp, hashIp } from "../http/client-ip.js";

export const leadsRouter: Router = Router();

/** Collapse repeat submissions from the same person inside this window. */
const DEDUPE_HOURS = 24;

interface ExistingLeadRow extends RowDataPacket {
  id: string;
}

leadsRouter.post("/", async (req: Request, res: Response<LeadResult>) => {
  if (!env.LEADS_INGEST_SECRET) {
    logger.warn("leads: LEADS_INGEST_SECRET unset — refusing to accept leads");
    return res.status(503).json({ ok: false });
  }

  const presented = req.headers["x-leads-secret"];
  if (presented !== env.LEADS_INGEST_SECRET) {
    logger.warn({ ip: hashIp(clientIp(req)) }, "leads: bad or missing secret");
    return res.status(401).json({ ok: false });
  }

  const input = LeadInput.parse(req.body);

  // Honeypot. Answer 200 and drop it — a visible rejection only teaches the
  // bot which field gave it away.
  if (input.website && input.website.trim().length > 0) {
    logger.info({ source: input.source }, "leads: honeypot triggered, discarding");
    return res.json({ ok: true });
  }

  const email = input.email.trim().toLowerCase();
  const ipHash = hashIp(clientIp(req));

  // A double-click, or someone filling the form again a minute later, is one
  // lead. Update rather than insert so the newest details win without
  // producing two rows to chase.
  const [existing] = await pool.execute<ExistingLeadRow[]>(
    `SELECT id FROM leads
      WHERE email = ? AND source = ?
        AND created_at > DATE_SUB(NOW(), INTERVAL ? HOUR)
      ORDER BY created_at DESC LIMIT 1`,
    [email, input.source, DEDUPE_HOURS]
  );

  if (existing.length > 0) {
    await pool.execute<ResultSetHeader>(
      `UPDATE leads
          SET name = COALESCE(?, name),
              phone = COALESCE(?, phone),
              business_name = COALESCE(?, business_name),
              business_type = COALESCE(?, business_type),
              message = COALESCE(?, message)
        WHERE id = ?`,
      [
        input.name ?? null,
        input.phone ?? null,
        input.businessName ?? null,
        input.businessType ?? null,
        input.message ?? null,
        existing[0].id,
      ]
    );
    logger.info({ leadId: existing[0].id, source: input.source }, "leads: merged duplicate");
    return res.json({ ok: true });
  }

  const id = randomUUID();
  await pool.execute<ResultSetHeader>(
    `INSERT INTO leads
       (id, source, email, name, phone, business_name, business_type, message, referer, ip_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.source,
      email,
      input.name ?? null,
      input.phone ?? null,
      input.businessName ?? null,
      input.businessType ?? null,
      input.message ?? null,
      input.referer ?? null,
      ipHash,
    ]
  );

  logger.info({ leadId: id, source: input.source }, "leads: captured");

  // Best-effort, and deliberately after the INSERT: the row is the record, the
  // email is a nudge. A Resend outage must not lose a lead — that is the exact
  // failure this feature was built to stop.
  const lines = [
    `Source: ${input.source}`,
    `Email: ${email}`,
    input.name ? `Name: ${input.name}` : null,
    input.businessName ? `Business: ${input.businessName}` : null,
    input.businessType ? `Type: ${input.businessType}` : null,
    input.phone ? `Phone: ${input.phone}` : null,
    input.message ? `\nMessage:\n${input.message}` : null,
    input.referer ? `\nFrom page: ${input.referer}` : null,
  ].filter(Boolean) as string[];

  const escapeHtml = (v: string): string =>
    v
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  void sendEmail({
    // Goes to us, not a tenant — merchantId stays null.
    kind: "lead_notification",
    to: env.LEADS_NOTIFY_EMAIL,
    subject:
      input.source === "demo"
        ? `New demo request — ${input.businessName ?? email}`
        : `New newsletter signup — ${email}`,
    text: lines.join("\n"),
    // Everything here is attacker-controlled free text straight off a public
    // form, so it is escaped before going anywhere near an HTML body.
    html:
      `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6">` +
      lines.map((l) => `<p style="margin:0 0 6px">${escapeHtml(l)}</p>`).join("") +
      `</div>`,
  }).catch((err: unknown) => {
    logger.error({ err, leadId: id }, "leads: notification email failed");
  });

  return res.status(201).json({ ok: true });
});
