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
  const { jwt, user, merchant, preferences } = await requireSession();

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
    <DashboardShell
      user={user}
      merchant={merchant}
      isPremium={preferences.isPremium}
      breadcrumb={`${merchant.businessName} · ${detail.card.customerName ?? "(no name)"}`}
      title={detail.card.programName}
    >
      <div className="space-y-4">
        <Link
          href="/dashboard/cards"
          className="inline-flex items-center text-sm text-brand-olive hover:text-brand-green underline-offset-4 hover:underline"
        >
          ← Back to cards
        </Link>

        <header className="rounded-card bg-white border border-brand-green/10 p-6">
          <div className="flex items-start justify-between gap-6">
            <div>
              <p className="text-xs uppercase tracking-wider text-brand-olive">
                Customer
              </p>
              <h2 className="font-serif text-3xl text-brand-green mt-1">
                {detail.card.customerName ?? "(no name)"}
              </h2>
              <p className="text-sm text-brand-olive mt-2">
                {detail.card.programName} · reward:{" "}
                <span className="text-brand-green font-medium">
                  {detail.card.rewardText}
                </span>
              </p>
            </div>
            <div className="text-right shrink-0">
              <div className="font-serif text-5xl text-brand-green tabular-nums">
                {current}
                <span className="text-brand-olive/60 text-3xl">/{required}</span>
              </div>
              <p className="text-xs uppercase tracking-wider text-brand-olive mt-1">
                {unitLabel}
              </p>
              <p className="text-xs text-brand-olive mt-2">
                lifetime {totalLifetime} · redeemed {rewardsRedeemed}
                {isPoints && totalExpired > 0 ? ` · expired ${totalExpired}` : ""}
              </p>
            </div>
          </div>
          <div className="mt-6 border-t border-brand-green/10 pt-5">
            <CardActions
              cardId={detail.card.id}
              eligible={eligible}
              programType={detail.card.programType}
              pointsPerEuro={detail.card.pointsPerEuro}
            />
          </div>
        </header>

        <section className="rounded-card bg-white border border-brand-green/10 p-6">
          <h3 className="font-serif text-2xl text-brand-green">Pass &amp; QR</h3>
          <div className="mt-4">
            <WalletSection
              cardId={detail.card.id}
              walletUrl={walletLink.available ? walletLink.url : null}
              applePassUrl={`${publicWebBase()}/v1/public/c/${detail.card.qrToken}/apple-pass`}
              qrSvg={qrSvg}
              qrToken={detail.card.qrToken}
              customerHasEmail={!!customer?.email}
            />
          </div>
        </section>

        <section className="rounded-card bg-white border border-brand-green/10 p-6">
          <h3 className="font-serif text-2xl text-brand-green">Activity</h3>
          <div className="mt-4">
            <EventTimeline events={detail.events} />
          </div>
        </section>
      </div>
    </DashboardShell>
  );
}
