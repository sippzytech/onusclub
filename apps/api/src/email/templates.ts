export interface WalletInviteInput {
  businessName: string;
  customerName: string | null;
  rewardText: string;
  stampsRequired: number;
  walletSaveUrl: string;
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
    `Add the card to your Google Wallet now (single tap):\n${input.walletSaveUrl}\n\n` +
    `Show this pass at the till on your next visit and we'll stamp it for you.\n\n` +
    `— ${input.businessName}, powered by Stampdeck`;

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
          <a href="${input.walletSaveUrl}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;font-weight:500;font-size:15px;padding:14px 24px;border-radius:8px;">
            Add to Google Wallet
          </a>
        </td></tr>
        <tr><td style="padding:8px 32px 24px;font-size:13px;color:#6b7280;line-height:1.5;">
          <p style="margin:0;">Show this pass at the till on your next visit and we'll stamp it for you. Your card updates automatically — no app to download.</p>
        </td></tr>
        <tr><td style="padding:16px 32px;background:#fafaf9;font-size:12px;color:#9ca3af;border-top:1px solid #e7e5e4;">
          Sent by ${business} · Powered by Stampdeck
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  return { subject, html, text };
}
