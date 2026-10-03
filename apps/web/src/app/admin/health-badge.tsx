import type { AdminHealthFlag } from "@onusclub/shared";

/**
 * What each flag means and what to do about it.
 *
 * `action` is not decoration. A flag that does not tell the reader what it
 * implies is just a coloured word, and the whole point of this list is to
 * decide which café to contact this week. Same principle as the RFM segment
 * copy on the merchant-facing analytics page.
 */
export const FLAG_COPY: Record<
  AdminHealthFlag,
  { label: string; tone: string; action: string }
> = {
  never_used: {
    label: "Never used",
    tone: "bg-red-50 text-red-800 border-red-200",
    action: "Signed up and never scanned anything. Needs onboarding or it will churn silently.",
  },
  dormant: {
    label: "Dormant",
    tone: "bg-orange-50 text-orange-800 border-orange-200",
    action:
      "It worked once and then stopped. Usually staff stopping rather than customers — worth a call.",
  },
  dead_enrolments: {
    label: "Dead enrolments",
    tone: "bg-amber-50 text-amber-900 border-amber-200",
    action:
      "Most cards were handed out and never used again. Either nobody returns, or staff stopped scanning returning customers.",
  },
  low_wallet_adoption: {
    label: "Low wallet adoption",
    tone: "bg-sky-50 text-sky-800 border-sky-200",
    action:
      "Cards exist but few are actually saved to a phone, so none of the push notifications reach anyone. Check how they are sharing the signup link.",
  },
  low_capture: {
    label: "Low sale capture",
    tone: "bg-violet-50 text-violet-800 border-violet-200",
    action:
      "Staff skip the sale-amount prompt, so this café's revenue and AOV figures mean very little — on their dashboard and on ours.",
  },
  onboarding: {
    label: "Onboarding",
    tone: "bg-slate-100 text-slate-600 border-slate-200",
    action: "Too new to judge. Check back once there is some activity.",
  },
  healthy: {
    label: "Healthy",
    tone: "bg-emerald-50 text-emerald-800 border-emerald-200",
    action: "Active, scanning, and wallets are being used. Nothing to do.",
  },
};

export function HealthBadge({
  flag,
  className = "",
}: {
  flag: AdminHealthFlag;
  className?: string;
}): JSX.Element {
  const copy = FLAG_COPY[flag];
  return (
    <span
      title={copy.action}
      className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${copy.tone} ${className}`}
    >
      {copy.label}
    </span>
  );
}
