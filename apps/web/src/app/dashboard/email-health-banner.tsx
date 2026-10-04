import Link from "next/link";
import type { EmailHealth } from "@onusclub/shared";

/**
 * Quiet warning when this café's email is not arriving.
 *
 * Deliberately not a permanent panel. A café with working email should see
 * nothing at all — a dashboard that always shows an "email: fine" box trains
 * people to ignore the spot where the real warning will appear.
 *
 * `skipped` is never a warning. It means no mail provider is configured, which
 * is normal in local dev and would otherwise fire on every single page load.
 */
export function EmailHealthBanner({ health }: { health: EmailHealth | null }): JSX.Element | null {
  if (!health || health.failed === 0) return null;

  const total = health.sent + health.failed;
  const share = total > 0 ? Math.round((health.failed / total) * 100) : 100;

  // Everything failing is a different problem from one address bouncing: the
  // first is us (a hit send limit, a bad key, a provider outage), the second
  // is usually a typo in a customer's address.
  const everything = health.sent === 0;
  const kinds = Array.from(new Set(health.recentFailures.map((f) => f.kind)));
  const invitesAffected = kinds.includes("card_invite");

  return (
    <div className="rounded-card border border-amber-300 bg-amber-50 px-5 py-4 mb-6">
      <p className="text-sm font-medium text-amber-900">
        {everything
          ? `No emails have been delivered in the last ${health.windowDays} days.`
          : `${health.failed} email${health.failed === 1 ? "" : "s"} failed to send in the last ${
              health.windowDays
            } days (${share}%).`}
      </p>
      <p className="text-sm text-amber-800 mt-1">
        {invitesAffected
          ? "Some customers did not receive their card link. They can still add the card — show them the QR code at the counter."
          : "Sign-in and password emails may not be arriving."}
      </p>
      <p className="text-xs text-amber-800 mt-2">
        {/* Say who fixes it. A warning a café owner cannot act on is just
            anxiety — this one is almost always ours. */}
        We can see this too and are looking into it.{" "}
        <Link href="/dashboard/settings" className="underline">
          See the details
        </Link>
      </p>
    </div>
  );
}
