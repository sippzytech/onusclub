import type { EmailHealth } from "@onusclub/shared";

const KIND_LABEL: Record<string, string> = {
  welcome: "Welcome email",
  card_invite: "Card invite",
  magic_link: "Sign-in link",
  password_reset: "Password reset",
  admin_password_reset: "Password reset (by support)",
  lead_notification: "Lead notification",
  weekly_digest: "Weekly summary",
};

/**
 * The detail behind the dashboard banner.
 *
 * `skipped` gets its own line rather than being folded into a total. "Nothing
 * is being sent because email is not configured" and "sending is failing" look
 * identical in a single count and need completely different responses.
 */
export function EmailHealthPanel({ health }: { health: EmailHealth | null }): JSX.Element {
  if (!health) {
    return (
      <p className="text-sm text-brand-olive">
        Email delivery records aren&apos;t available yet.
      </p>
    );
  }

  const attempted = health.sent + health.failed;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-brand-green/15 px-4 py-3">
          <p className="text-xs text-brand-olive">Delivered</p>
          <p className="font-serif text-2xl text-brand-green tabular-nums">{health.sent}</p>
        </div>
        <div
          className={`rounded-lg border px-4 py-3 ${
            health.failed > 0
              ? "border-amber-300 bg-amber-50"
              : "border-brand-green/15"
          }`}
        >
          <p className="text-xs text-brand-olive">Failed</p>
          <p
            className={`font-serif text-2xl tabular-nums ${
              health.failed > 0 ? "text-amber-900" : "text-brand-green"
            }`}
          >
            {health.failed}
          </p>
        </div>
        <div className="rounded-lg border border-brand-green/15 px-4 py-3">
          <p className="text-xs text-brand-olive">Not sent</p>
          <p className="font-serif text-2xl text-brand-green tabular-nums">{health.skipped}</p>
        </div>
      </div>

      <p className="text-xs text-brand-olive">
        Last {health.windowDays} days.
        {/* "Delivered" is Resend accepting it, which is not the same as it
            landing in an inbox. Saying so is better than implying more
            certainty than we have. */}
        {attempted > 0 &&
          " “Delivered” means our email provider accepted it — it can still be caught by a spam filter."}
        {health.skipped > 0 &&
          " “Not sent” means email delivery isn’t switched on for this account yet."}
      </p>

      {health.recentFailures.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-brand-green">What failed</h3>
          <ul className="mt-2 space-y-1.5 text-sm">
            {health.recentFailures.map((f) => (
              <li
                key={f.id}
                className="flex flex-wrap items-baseline gap-x-2 border-t border-brand-green/10 pt-1.5 first:border-0 first:pt-0"
              >
                <span className="text-brand-green">{KIND_LABEL[f.kind] ?? f.kind}</span>
                <span className="text-xs text-brand-olive">{f.toEmail}</span>
                {f.error && (
                  <span className="text-xs text-amber-800">{f.error}</span>
                )}
                <span className="ml-auto text-xs text-brand-olive tabular-nums">
                  {f.createdAt.slice(0, 16).replace("T", " ")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
