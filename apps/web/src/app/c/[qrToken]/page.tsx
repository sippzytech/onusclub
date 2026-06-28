import { notFound } from "next/navigation";
import type { PublicCardView } from "@onusclub/shared";
import { ApiCallError, apiFetch } from "@/lib/api";

export const dynamic = "force-dynamic";

function apiBase(): string {
  return (
    process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, "") ?? "http://localhost:4000"
  );
}

export default async function PublicCardPage({
  params,
}: {
  params: { qrToken: string };
}): Promise<JSX.Element> {
  let card: PublicCardView;
  try {
    card = await apiFetch<PublicCardView>(`/v1/public/c/${params.qrToken}`);
  } catch (err) {
    if (err instanceof ApiCallError && err.status === 404) notFound();
    throw err;
  }

  // The api populates `currentValue` / `targetValue` / `unitLabel` for both
  // program types. Legacy `stampsCurrent` / `stampsRequired` are still
  // populated as aliases so older snapshots of this page keep rendering.
  const current = card.currentValue ?? card.stampsCurrent;
  const target = card.targetValue ?? card.stampsRequired;
  const unit = card.unitLabel ?? "stamps";
  const unitSingular = unit === "points" ? "point" : "stamp";
  const remaining = Math.max(0, target - current);
  const eligible = target > 0 && current >= target;

  return (
    <main className="min-h-screen px-6 py-12 bg-brand-cream">
      <div className="mx-auto max-w-md space-y-4">
        {/* Brand-coloured hero card. Uses the merchant's brand colour if set
         * (falls back to brand green). Cream text reads on dark merchant
         * colours and stays on-brand. */}
        <header
          className="rounded-card p-6 text-brand-cream shadow-sm"
          style={{ backgroundColor: card.brandColor ?? "#14271C" }}
        >
          <p className="text-xs uppercase tracking-wider opacity-80">
            Loyalty card
          </p>
          <h1 className="font-serif text-3xl mt-1">{card.businessName}</h1>
          <p className="text-sm opacity-90 mt-2">
            {card.customerName ?? "Welcome"} · {card.programName}
          </p>
          <div className="mt-6 flex items-end justify-between">
            <div>
              <p className="font-serif text-5xl tabular-nums">
                {current}
                <span className="text-3xl opacity-70">/{target}</span>
              </p>
              <p className="text-xs uppercase tracking-wider opacity-70 mt-1">
                {unit}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wider opacity-70">Reward</p>
              <p className="text-sm font-medium mt-1">{card.rewardText}</p>
            </div>
          </div>
        </header>

        {card.status === "expired" ? (
          <div className="rounded-card border border-brand-olive/20 bg-white p-4 text-sm text-brand-green">
            <p className="font-medium">This card has expired</p>
            <p className="mt-1 text-brand-olive">
              Ask the cafe to enrol you on a new card next time you visit.
            </p>
          </div>
        ) : card.status === "blocked" ? (
          <div className="rounded-card border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <p className="font-medium">This card is blocked</p>
            <p className="mt-1 text-red-700">Please contact the cafe.</p>
          </div>
        ) : eligible ? (
          <div className="rounded-card border border-brand-gold/30 bg-brand-gold/10 p-4 text-sm text-brand-green">
            <p className="font-medium">🎉 Reward unlocked</p>
            <p className="mt-1">
              Show this pass at {card.businessName} to claim:{" "}
              <strong>{card.rewardText}</strong>.
            </p>
          </div>
        ) : (
          <div className="rounded-card bg-white border border-brand-green/10 p-4 text-sm text-brand-green">
            <p>
              <strong>{remaining}</strong>{" "}
              {remaining === 1 ? unitSingular : unit} to go. Visit{" "}
              {card.businessName} on your next coffee run!
            </p>
            <p className="text-xs text-brand-olive mt-2">
              {card.rewardsRedeemed > 0 ? (
                <>
                  You&apos;ve already redeemed {card.rewardsRedeemed}{" "}
                  {card.rewardsRedeemed === 1 ? "reward" : "rewards"} on this card.
                </>
              ) : (
                `First reward coming up — your ${unit} are saved across visits.`
              )}
            </p>
          </div>
        )}

        {card.status === "active" ? (
          <div className="rounded-card bg-white border border-brand-green/10 p-5 space-y-3">
            <p className="font-medium text-brand-green">Save to your phone</p>
            <p className="text-sm text-brand-olive">
              Pick your phone and we&apos;ll keep your {unit} updated automatically.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              {card.walletSaveUrl ? (
                <a
                  href={card.walletSaveUrl}
                  className="inline-block rounded-full bg-brand-green px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-green-deep text-center transition-colors"
                >
                  Add to Google Wallet
                </a>
              ) : null}
              <a
                href={`${apiBase()}/v1/public/c/${params.qrToken}/apple-pass`}
                className="inline-block rounded-full border border-brand-green/20 px-4 py-2.5 text-sm font-medium text-brand-green hover:bg-brand-cream text-center transition-colors"
              >
                Add to Apple Wallet
              </a>
            </div>
          </div>
        ) : null}

        <p className="text-xs text-brand-olive text-center pt-2">
          Powered by{" "}
          <a
            href="https://onusclub.com"
            className="hover:text-brand-green underline-offset-4 hover:underline"
          >
            OnUsClub
          </a>
        </p>
      </div>
    </main>
  );
}
