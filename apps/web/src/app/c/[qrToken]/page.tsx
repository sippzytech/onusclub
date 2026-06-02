import { notFound } from "next/navigation";
import type { PublicCardView } from "@stampdeck/shared";
import { ApiCallError, apiFetch } from "@/lib/api";

export const dynamic = "force-dynamic";

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

  const brand = card.brandColor ?? "#111111";
  const remaining = card.stampsRequired - card.stampsCurrent;
  const eligible = card.stampsCurrent >= card.stampsRequired;

  return (
    <main className="min-h-screen px-6 py-12">
      <div className="mx-auto max-w-md space-y-6">
        <header
          className="rounded-2xl p-6 text-white shadow-sm"
          style={{ backgroundColor: brand }}
        >
          <p className="text-xs uppercase tracking-wide opacity-80">Loyalty card</p>
          <h1 className="text-2xl font-semibold mt-1">{card.businessName}</h1>
          <p className="text-sm opacity-90 mt-2">
            {card.customerName ?? "Welcome"} · {card.programName}
          </p>
          <div className="mt-6 flex items-end justify-between">
            <div>
              <p className="text-5xl font-semibold tabular-nums">
                {card.stampsCurrent}
                <span className="text-3xl opacity-70">/{card.stampsRequired}</span>
              </p>
              <p className="text-sm opacity-80 mt-1">stamps</p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wide opacity-80">Reward</p>
              <p className="text-sm font-medium mt-1">{card.rewardText}</p>
            </div>
          </div>
        </header>

        {card.status === "expired" ? (
          <div className="rounded-md border border-gray-200 bg-gray-50 p-4 text-sm text-gray-800">
            <p className="font-medium">This card has expired</p>
            <p className="mt-1 text-gray-600">
              Ask the cafe to enrol you on a new card next time you visit.
            </p>
          </div>
        ) : card.status === "blocked" ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <p className="font-medium">This card is blocked</p>
            <p className="mt-1 text-red-700">Please contact the cafe.</p>
          </div>
        ) : eligible ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            <p className="font-medium">🎉 Reward unlocked!</p>
            <p className="mt-1 text-emerald-800">
              Show this pass at {card.businessName} to claim:{" "}
              <strong>{card.rewardText}</strong>.
            </p>
          </div>
        ) : (
          <div className="rounded-md border border-gray-200 bg-white p-4 text-sm text-gray-700">
            <p>
              <strong>{remaining}</strong>{" "}
              {remaining === 1 ? "stamp" : "stamps"} to go.
              Visit {card.businessName} on your next coffee run!
            </p>
            <p className="text-xs text-gray-500 mt-2">
              {card.rewardsRedeemed > 0 ? (
                <>
                  You&apos;ve already redeemed {card.rewardsRedeemed}{" "}
                  {card.rewardsRedeemed === 1 ? "reward" : "rewards"} on this card.
                </>
              ) : (
                "First reward coming up — your stamps are saved across visits."
              )}
            </p>
          </div>
        )}

        {card.walletSaveUrl && card.status === "active" ? (
          <div className="rounded-md border border-gray-200 bg-white p-4 text-sm text-gray-700 space-y-3">
            <p className="font-medium text-gray-900">Save to Google Wallet</p>
            <p className="text-gray-600">
              Skip the URL next time — keep the card in your wallet app and we&apos;ll
              auto-update your stamps as you collect them.
            </p>
            <a
              href={card.walletSaveUrl}
              className="inline-block rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
            >
              Add to Google Wallet
            </a>
          </div>
        ) : null}

        <p className="text-xs text-gray-500 text-center pt-2">
          Powered by Stampdeck
        </p>
      </div>
    </main>
  );
}
