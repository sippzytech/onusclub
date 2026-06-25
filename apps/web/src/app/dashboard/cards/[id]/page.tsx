import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import type { CardDetail, Customer, WalletLink } from "@onusclub/shared";
import { ApiCallError, apiFetch } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { DashboardShell } from "../../dashboard-shell";
import { CardActions } from "./card-actions";
import { EventTimeline } from "./event-timeline";
import { WalletSection } from "./wallet-section";

export const dynamic = "force-dynamic";

function publicWebBase(): string {
  return (
    process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, "") ?? "http://localhost:4000"
  );
}

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
  // Look up the customer to know if we have an email on file (controls
  // whether the "Resend invite" button is offered).
  const { customers } = await apiFetch<{ customers: Customer[] }>("/v1/customers", { jwt });
  const customer = customers.find((c) => c.id === detail.card.customerId) ?? null;

  // Type-branched view-model: same UI shell, different labels + numbers per
  // program type. The CardActions component below switches its button set
  // off `programType` too.
  const isPoints = detail.card.programType === "points";
  const rawState = detail.card.cardState as Record<string, number | string>;
  const current = isPoints ? Number(rawState.points_current ?? 0) : Number(rawState.stamps_current ?? 0);
  const required = isPoints
    ? Number(detail.card.pointsForReward ?? 0)
    : detail.card.stampsRequired;
  const totalLifetime = Number(rawState.total_lifetime ?? 0);
  const rewardsRedeemed = Number(rawState.rewards_redeemed ?? 0);
  const totalExpired = isPoints ? Number(rawState.total_expired ?? 0) : 0;
  const eligible = current >= required && required > 0;
  const unitLabel = isPoints ? "points" : "stamps";

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
                {current}
                <span className="text-gray-400 text-3xl">/{required}</span>
              </div>
              <p className="text-xs uppercase tracking-wide text-gray-400 mt-1">
                {unitLabel}
              </p>
              <p className="text-xs text-gray-500 mt-2">
                lifetime {totalLifetime} · redeemed {rewardsRedeemed}
                {isPoints && totalExpired > 0 ? ` · expired ${totalExpired}` : ""}
              </p>
            </div>
          </div>
          <div className="mt-6 border-t border-gray-100 pt-4">
            <CardActions
              cardId={detail.card.id}
              eligible={eligible}
              programType={detail.card.programType}
              pointsPerEuro={detail.card.pointsPerEuro}
            />
          </div>
        </header>

        <section className="space-y-3">
          <h3 className="text-base font-medium text-gray-900">Pass &amp; QR</h3>
          <WalletSection
            cardId={detail.card.id}
            walletUrl={walletLink.available ? walletLink.url : null}
            applePassUrl={`${publicWebBase()}/v1/public/c/${detail.card.qrToken}/apple-pass`}
            qrSvg={qrSvg}
            qrToken={detail.card.qrToken}
            customerHasEmail={!!customer?.email}
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
