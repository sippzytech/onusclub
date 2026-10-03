import Link from "next/link";
import { notFound } from "next/navigation";
import {
  centsToEuroString,
  type AdminCardView,
  type PointsCardState,
  type StampCardState,
} from "@onusclub/shared";
import { apiFetch, ApiCallError } from "@/lib/api";
import { requireAdminSession } from "@/lib/admin-session";
import { AdminShell } from "../../admin-shell";
import { EVENT_LABEL } from "../../event-label";

export const dynamic = "force-dynamic";

export default async function AdminCardPage({
  params,
}: {
  params: { id: string };
}): Promise<JSX.Element> {
  const { jwt, admin } = await requireAdminSession();

  let view: AdminCardView;
  try {
    view = await apiFetch<AdminCardView>(`/v1/admin/cards/${params.id}`, { jwt });
  } catch (err) {
    if (err instanceof ApiCallError && err.status === 404) notFound();
    throw err;
  }

  const { card, events } = view.detail;
  const isPoints = card.programType === "points";
  const state = card.cardState as StampCardState | PointsCardState;

  // ⚠️ Points come from view.pointsBalance — the batch ledger — and NOT from
  // cardState.points_current, which is a cache the café's next transaction
  // recomputes. Rendering the cached column here would show a drifted value as
  // fact on the one screen used to answer "my customer says their points are
  // wrong".
  const balance = isPoints
    ? `${view.pointsBalance ?? 0} / ${card.pointsForReward ?? "?"} points`
    : `${(state as StampCardState).stamps_current} / ${card.stampsRequired} stamps`;

  return (
    <AdminShell
      admin={admin}
      breadcrumb={
        <>
          <Link href={`/admin/merchants/${view.merchantId}`} className="underline">
            {view.merchantName}
          </Link>
          {" · "}
          <Link href={`/admin/customers/${view.customerId}`} className="underline">
            {card.customerName ?? "Unnamed customer"}
          </Link>
        </>
      }
      title={card.programName}
    >
      <div className="grid lg:grid-cols-3 gap-4">
        <section className="rounded-xl bg-white border border-slate-200 p-5">
          <h2 className="text-sm font-medium text-slate-900 mb-2">Balance</h2>
          <p className="font-serif text-3xl text-slate-900 tabular-nums">{balance}</p>
          <p className="text-xs text-slate-600 mt-2">{card.rewardText}</p>

          {/* A drift means something wrote card_state without going through
              the batch ledger. Surfaced rather than quietly corrected — this
              is the right place to find out about it. */}
          {view.pointsCacheStale && (
            <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              The cached balance on this card reads{" "}
              <strong>{(state as PointsCardState).points_current}</strong>, but the points ledger
              totals <strong>{view.pointsBalance}</strong>. The ledger is correct and is what is
              shown above; the café&apos;s next transaction will recompute the cache. Worth
              investigating what wrote it.
            </p>
          )}
          <dl className="mt-4 pt-4 border-t border-slate-100 text-sm space-y-1.5">
            <div className="flex justify-between gap-3">
              <dt className="text-slate-600">Earned, lifetime</dt>
              <dd className="tabular-nums text-slate-900">{state.total_lifetime}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-600">Rewards redeemed</dt>
              <dd className="tabular-nums text-slate-900">{state.rewards_redeemed}</dd>
            </div>
            {isPoints && (
              <div className="flex justify-between gap-3">
                <dt className="text-slate-600">Points expired</dt>
                <dd className="tabular-nums text-slate-900">
                  {(state as PointsCardState).total_expired}
                </dd>
              </div>
            )}
          </dl>
        </section>

        <section className="rounded-xl bg-white border border-slate-200 p-5 lg:col-span-2">
          <h2 className="text-sm font-medium text-slate-900 mb-2">Card</h2>
          <dl className="text-sm space-y-1.5">
            <div className="flex justify-between gap-3">
              <dt className="text-slate-600">Program type</dt>
              <dd className="text-slate-900">{card.programType}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-600">Status</dt>
              <dd className="text-slate-900">{card.status}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-600">Issued</dt>
              <dd className="text-slate-900">{card.createdAt.slice(0, 10)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-600">Last activity</dt>
              <dd className="text-slate-900">
                {card.lastEventAt ? card.lastEventAt.slice(0, 16).replace("T", " ") : "never"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-600">QR token</dt>
              <dd className="text-slate-900 font-mono text-[11px] break-all">{card.qrToken}</dd>
            </div>
          </dl>
          {/* The customer-facing page, for reproducing what they are actually
              looking at when they report something wrong. */}
          <Link
            href={`/c/${card.qrToken}`}
            target="_blank"
            className="inline-block mt-4 text-sm text-slate-700 underline"
          >
            Open the customer&apos;s own card view ↗
          </Link>
        </section>
      </div>

      <section className="rounded-xl bg-white border border-slate-200 p-5 mt-4">
        <h2 className="text-sm font-medium text-slate-900">
          History <span className="text-slate-400">({events.length})</span>
        </h2>
        {events.length === 0 ? (
          <p className="text-sm text-slate-600 mt-2">Nothing has happened on this card.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 text-sm">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 py-1.5">
                <span
                  className={
                    e.eventType === "manual_adjust"
                      ? "text-amber-800 font-medium"
                      : "text-slate-900"
                  }
                >
                  {EVENT_LABEL[e.eventType] ?? e.eventType}
                </span>
                {e.note ? <span className="text-xs text-slate-600">{e.note}</span> : null}
                <span className="ml-auto text-slate-500 tabular-nums whitespace-nowrap">
                  {e.amountCents !== null && <>{centsToEuroString(e.amountCents)} · </>}
                  {e.createdAt.slice(0, 16).replace("T", " ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AdminShell>
  );
}
