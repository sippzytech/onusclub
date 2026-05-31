import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import type { CardDetail, WalletLink } from "@stampdeck/shared";
import { ApiCallError, apiFetch } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { DashboardShell } from "../../dashboard-shell";
import { CardActions } from "./card-actions";
import { EventTimeline } from "./event-timeline";
import { WalletSection } from "./wallet-section";

export const dynamic = "force-dynamic";

export default async function CardDetailPage({
  params,
}: {
  params: { id: string };
}): Promise<JSX.Element> {
  const { jwt, user, merchant } = await requireSession();

  let detail: CardDetail;
  try {
    detail = await apiFetch<CardDetail>(`/v1/cards/${params.id}`, { jwt });
  } catch (err) {
    if (err instanceof ApiCallError && err.status === 404) notFound();
    throw err;
  }

  // Fetch the wallet save URL and pre-render the QR fallback server-side.
  // Both are best-effort: if either fails the rest of the page still renders.
  const walletLink = await apiFetch<WalletLink>(`/v1/cards/${params.id}/wallet-link`, {
    jwt,
  }).catch(() => ({ available: false, url: null }) as WalletLink);
  const qrSvg = await QRCode.toString(detail.card.qrToken, {
    type: "svg",
    margin: 1,
    width: 180,
  });

  const state = detail.card.cardState as {
    stamps_current: number;
    total_lifetime: number;
    rewards_redeemed: number;
  };
  const required = detail.card.stampsRequired;
  const eligible = state.stamps_current >= required;

  return (
    <DashboardShell user={user} merchant={merchant}>
      <div className="space-y-8">
        <Link href="/dashboard/cards" className="text-sm text-gray-600 underline">
          ← Back to cards
        </Link>

        <header className="rounded-lg border border-gray-200 bg-white p-6">
          <div className="flex items-start justify-between gap-6">
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-500">Customer</p>
              <h2 className="text-xl font-semibold text-gray-900 mt-1">
                {detail.card.customerName ?? "(no name)"}
              </h2>
              <p className="text-sm text-gray-600 mt-2">
                {detail.card.programName} · reward: {detail.card.rewardText}
              </p>
            </div>
            <div className="text-right shrink-0">
              <div className="text-5xl font-semibold tabular-nums text-gray-900">
                {state.stamps_current}
                <span className="text-gray-400 text-3xl">/{required}</span>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                lifetime {state.total_lifetime} · redeemed {state.rewards_redeemed}
              </p>
            </div>
          </div>
          <div className="mt-6 border-t border-gray-100 pt-4">
            <CardActions cardId={detail.card.id} eligible={eligible} />
          </div>
        </header>

        <section className="space-y-3">
          <h3 className="text-base font-medium text-gray-900">Pass &amp; QR</h3>
          <WalletSection
            walletUrl={walletLink.available ? walletLink.url : null}
            qrSvg={qrSvg}
            qrToken={detail.card.qrToken}
          />
        </section>

        <section className="space-y-3">
          <h3 className="text-base font-medium text-gray-900">Activity</h3>
          <EventTimeline events={detail.events} />
        </section>
      </div>
    </DashboardShell>
  );
}
