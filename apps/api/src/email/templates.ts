export interface WalletInviteInput {
  businessName: string;
  customerName: string | null;
  rewardText: string;
  stampsRequired: number;
  walletSaveUrl: string;
  // Apple Wallet `.pkpass` URL. Optional — when null the email shows only the
  // Google Wallet button, matching environments where Apple isn't configured.
  applePassUrl: string | null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function walletInviteEmail(input: WalletInviteInput): {
  subject: string;
  html: string;
  text: string;
} {
  const business = escapeHtml(input.businessName);
  const greeting = input.customerName ? `Hi ${escapeHtml(input.customerName)},` : "Hello,";
  const reward = escapeHtml(input.rewardText);

  const subject = `Your loyalty card for ${input.businessName} is ready`;

  const text =
    `${input.customerName ? `Hi ${input.customerName},` : "Hello,"}\n\n` +
    `${input.businessName} just set up your digital loyalty card.\n\n` +
    `Collect ${input.stampsRequired} stamps and earn: ${input.rewardText}.\n\n` +
    `Save it to your phone:\n` +
    `• Google Wallet (Android): ${input.walletSaveUrl}\n` +
    (input.applePassUrl ? `• Apple Wallet (iPhone): ${input.applePassUrl}\n` : "") +
    `\nShow this pass at the till on your next visit and we'll stamp it for you.\n\n` +
    `— ${input.businessName}, powered by OnUsClub`;

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f5f5f4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e7e5e4;">
        <tr><td style="padding:32px 32px 8px;">
          <p style="margin:0;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#78716c;">Your loyalty card</p>
          <h1 style="margin:8px 0 0;font-size:22px;line-height:1.3;color:#111;">${business}</h1>
        </td></tr>
        <tr><td style="padding:24px 32px 8px;font-size:15px;line-height:1.5;color:#374151;">
          <p style="margin:0 0 12px;">${greeting}</p>
          <p style="margin:0 0 12px;">
            ${business} just set up your digital loyalty card. Collect
            <strong>${input.stampsRequired} stamps</strong> and earn: <strong>${reward}</strong>.
          </p>
          <p style="margin:0;">Tap below to save the card to Google Wallet:</p>
        </td></tr>
        <tr><td align="center" style="padding:24px 32px 8px;">
          <a href="${input.walletSaveUrl}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;font-weight:500;font-size:15px;padding:14px 24px;border-radius:8px;margin:0 4px 8px;">
            Add to Google Wallet
          </a>
          ${
            input.applePassUrl
              ? `<a href="${input.applePassUrl}" style="display:inline-block;background:#000;color:#fff;text-decoration:none;font-weight:500;font-size:15px;padding:14px 24px;border-radius:8px;margin:0 4px 8px;">Add to Apple Wallet</a>`
              : ""
          }
        </td></tr>
        <tr><td align="center" style="padding:0 32px 8px;font-size:12px;color:#9ca3af;">
          Android phones use Google Wallet, iPhones use Apple Wallet.
        </td></tr>
        <tr><td style="padding:8px 32px 24px;font-size:13px;color:#6b7280;line-height:1.5;">
          <p style="margin:0;">Show this pass at the till on your next visit and we'll stamp it for you. Your card updates automatically — no app to download.</p>
        </td></tr>
        <tr><td style="padding:16px 32px;background:#fafaf9;font-size:12px;color:#9ca3af;border-top:1px solid #e7e5e4;">
          Sent by ${business} · Powered by OnUsClub
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Weekly merchant digest (backlog item 18)
//
// Written to be read in five seconds on a phone, standing behind a counter.
// Four numbers, one sentence of interpretation, one link.
//
// The interpretation line is the point. "47 stamps" means nothing on its own;
// "47 stamps, up from 31" is a reason to keep going, and "nothing scanned this
// week" is a reason to open the dashboard. A digest that only lists figures is
// a report nobody reads twice.
// ---------------------------------------------------------------------------

export interface WeeklyDigestInput {
  businessName: string;
  dashboardUrl: string;
  scans: number;
  previousScans: number;
  newCustomers: number;
  rewardsRedeemed: number;
  /** Pre-formatted, or null when no sales were captured — never "€0.00". */
  revenue: string | null;
}

/** The one line that turns figures into something worth acting on. */
function digestHeadline(input: WeeklyDigestInput): string {
  if (input.scans === 0 && input.previousScans === 0) {
    return "Nothing was scanned this week. If your staff have stopped using the scanner, a quick reminder is usually all it takes.";
  }
  if (input.scans === 0) {
    return `Nothing was scanned this week, after ${input.previousScans} the week before. Worth checking that the scanner is still set up at the till.`;
  }
  if (input.previousScans === 0) {
    return `${input.scans} scan${input.scans === 1 ? "" : "s"} this week — your programme is up and running.`;
  }
  const change = input.scans - input.previousScans;
  // A percentage off a base of three is noise. Below five scans we talk in
  // whole numbers.
  if (change === 0) return `Exactly level with last week at ${input.scans} scans.`;
  const pct = Math.round((Math.abs(change) / input.previousScans) * 100);
  const direction = change > 0 ? "up" : "down";
  return input.previousScans < 5
    ? `${input.scans} scans this week, ${direction} from ${input.previousScans}.`
    : `${input.scans} scans this week — ${direction} ${pct}% on last week's ${input.previousScans}.`;
}

export function weeklyDigestEmail(input: WeeklyDigestInput): {
  subject: string;
  html: string;
  text: string;
} {
  const business = escapeHtml(input.businessName);
  const headline = digestHeadline(input);

  // The subject carries the numbers, so the digest is useful even unopened.
  const subject =
    input.scans === 0
      ? `${input.businessName}: a quiet week on your loyalty card`
      : `${input.businessName}: ${input.scans} scan${input.scans === 1 ? "" : "s"} this week`;

  const rows: Array<[string, string]> = [
    ["Scans", String(input.scans)],
    ["New members", String(input.newCustomers)],
    ["Rewards given", String(input.rewardsRedeemed)],
  ];
  if (input.revenue) rows.push(["Sales recorded", input.revenue]);

  const text =
    `Your week at ${input.businessName}\n\n` +
    `${headline}\n\n` +
    rows.map(([k, v]) => `${k}: ${v}`).join("\n") +
    `\n\nSee the full picture: ${input.dashboardUrl}\n\n` +
    `— OnUsClub\n\n` +
    `You're getting this because you have a loyalty programme with OnUsClub.\n` +
    `To stop these, switch off automated messages under Campaigns in your ` +
    `dashboard — note that also pauses birthday and win-back messages to your ` +
    `customers.`;

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f5f5f4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:520px;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e7e5e4;">
        <tr><td style="padding:28px 32px 8px;">
          <p style="margin:0;font-size:13px;color:#9ca3af;text-transform:uppercase;letter-spacing:.06em;">Your week</p>
          <h1 style="margin:4px 0 0;font-size:22px;font-weight:600;">${business}</h1>
        </td></tr>
        <tr><td style="padding:12px 32px 4px;font-size:15px;line-height:1.6;color:#374151;">
          <p style="margin:0;">${escapeHtml(headline)}</p>
        </td></tr>
        <tr><td style="padding:16px 32px 8px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
            ${rows
              .map(
                ([label, value]) => `<tr>
              <td style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:14px;color:#6b7280;">${escapeHtml(label)}</td>
              <td align="right" style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:18px;font-weight:600;">${escapeHtml(value)}</td>
            </tr>`
              )
              .join("")}
          </table>
        </td></tr>
        <tr><td align="center" style="padding:24px 32px 28px;">
          <a href="${input.dashboardUrl}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;font-weight:500;font-size:15px;padding:13px 24px;border-radius:8px;">
            Open your dashboard
          </a>
        </td></tr>
        <tr><td style="padding:16px 32px;background:#fafaf9;font-size:12px;color:#9ca3af;border-top:1px solid #e7e5e4;line-height:1.5;">
          Sent weekly by OnUsClub. To stop these, switch off automated messages under
          Campaigns in your dashboard &mdash; note that also pauses birthday and win-back
          messages to your customers.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  return { subject, html, text };
}
