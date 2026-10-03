import Link from "next/link";
import { notFound } from "next/navigation";
import {
  centsToEuroString,
  primaryHealthFlag,
  type AdminMerchantDetail,
  type RfmSegment,
} from "@onusclub/shared";
import { apiFetch, ApiCallError } from "@/lib/api";
import { requireAdminSession } from "@/lib/admin-session";
import { AdminShell } from "../../admin-shell";
import { FLAG_COPY, HealthBadge } from "../../health-badge";

export const dynamic = "force-dynamic";

const SEGMENT_LABEL: Record<RfmSegment, string> = {
  champions: "Champions",
  promising: "Promising",
  new: "New",
  at_risk: "At risk",
  sleeping: "Sleeping",
  lost: "Lost",
};

const EVENT_LABEL: Record<string, string> = {
  stamp: "Stamp",
  redeem: "Reward redeemed",
  points_add: "Points added",
  review_reward: "Review reward",
  signup: "Joined",
  expire: "Card expired",
  reset: "Card reset",
  // The operator-side label. The café sees its own wording for this on their
  // dashboard — "Adjusted by OnUsClub" — so they always know when we touched
  // their data.
  manual_adjust: "Adjusted by us",
};

function Row({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}): JSX.Element {
  return (
    <div className="flex justify-between gap-3 py-1.5">
      <dt className="text-slate-600">
        {label}
        {hint ? <span className="block text-[11px] text-slate-400">{hint}</span> : null}
      </dt>
      <dd className="tabular-nums text-slate-900 whitespace-nowrap">{value}</dd>
    </div>
  );
}

export default async function AdminMerchantDetailPage({
  params,
}: {
  params: { id: string };
}): Promise<JSX.Element> {
  const { jwt, admin } = await requireAdminSession();

  let detail: AdminMerchantDetail;
  try {
    detail = await apiFetch<AdminMerchantDetail>(`/v1/admin/merchants/${params.id}`, { jwt });
  } catch (err) {
    // An unknown merchant id is a 404 from the api; anything else is a real
    // failure and should surface as one rather than as "no such café".
    if (err instanceof ApiCallError && err.status === 404) notFound();
    throw err;
  }

  const m = detail.merchant;
  const flag = primaryHealthFlag(m.flags);
  const maxDay = Math.max(...detail.daily.map((d) => d.events), 1);
  const classified = detail.segments.reduce((acc, s) => acc + s.customers, 0);
  const money = (cents: number): string => centsToEuroString(cents, m.currencyCode);

  return (
    <AdminShell
      admin={admin}
      breadcrumb={
        <>
          <Link href="/admin/merchants" className="underline">
            Cafés
          </Link>
        </>
      }
      title={m.businessName}
    >
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <HealthBadge flag={flag} />
        {m.flags
          .filter((f) => f !== flag)
          .map((f) => (
            <HealthBadge key={f} flag={f} className="opacity-70" />
          ))}
        <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600">
          {m.status}
        </span>
        {m.isPremium && (
          <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600">
            premium
          </span>
        )}
        {!m.cronsEnabled && (
          <span
            className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800"
            title="Daily sweeps are switched off for this café — no expiry, birthday or win-back messages are being sent."
          >
            crons off
          </span>
        )}
      </div>

      <p className="text-sm text-slate-700 mb-5">{FLAG_COPY[flag].action}</p>

      <div className="grid lg:grid-cols-3 gap-4">
        <section className="rounded-xl bg-white border border-slate-200 p-5">
          <h2 className="text-sm font-medium text-slate-900 mb-1">Account</h2>
          <dl className="divide-y divide-slate-100 text-sm">
            <Row label="Owner" value={m.ownerEmail} />
            <Row label="Joined" value={m.createdAt.slice(0, 10)} />
            <Row
              label="Monthly fee"
              value={m.monthlyFeeCents === null ? "— not recorded" : money(m.monthlyFeeCents)}
            />
            <Row
              label="Trial"
              value={
                m.trial.endsAt === null
                  ? "no trial clock"
                  : m.trial.expired
                    ? `ended ${m.trial.endsAt.slice(0, 10)}`
                    : `${m.trial.daysLeft} day${m.trial.daysLeft === 1 ? "" : "s"} left`
              }
            />
            <Row label="Country" value={`${m.country} · ${m.currencyCode}`} />
            <Row label="Staff accounts" value={String(m.staff)} />
            <Row
              label="Signup page"
              value={m.publicSlug ? `/m/${m.publicSlug}` : "— no slug"}
            />
          </dl>
        </section>

        <section className="rounded-xl bg-white border border-slate-200 p-5">
          <h2 className="text-sm font-medium text-slate-900 mb-1">Usage</h2>
          <dl className="divide-y divide-slate-100 text-sm">
            <Row label="Customers" value={String(m.customers)} />
            <Row label="Cards issued" value={String(m.cards)} />
            <Row
              label="Saved to a phone"
              value={
                m.cards === 0
                  ? "—"
                  : `${m.walletCards} of ${m.cards} (${Math.round(
                      (m.walletCards / m.cards) * 100
                    )}%)`
              }
              hint={`${m.googlePasses} Google · ${m.applePasses} Apple`}
            />
            <Row
              label="Never used"
              value={m.matureCards === 0 ? "—" : `${m.deadEnrolments} of ${m.matureCards}`}
              hint={`cards older than ${detail.thresholds.cardMaturityDays} days with no activity`}
            />
            <Row
              label={`Scans, last ${detail.thresholds.windowDays} days`}
              value={String(m.eventsWindow)}
              hint={`${m.eventsTotal} all time`}
            />
            <Row
              label="Last scan"
              value={
                m.daysSinceLastEvent === null
                  ? "never"
                  : `${m.daysSinceLastEvent} day${m.daysSinceLastEvent === 1 ? "" : "s"} ago`
              }
            />
            <Row
              label="Rewards given"
              value={String(m.redemptionsTotal)}
              hint={`${m.redemptionsWindow} in the last ${detail.thresholds.windowDays} days`}
            />
          </dl>
        </section>

        <section className="rounded-xl bg-white border border-slate-200 p-5">
          <h2 className="text-sm font-medium text-slate-900 mb-1">Their sales</h2>
          {/* Said plainly, once, where the numbers are. These are the café's
              own self-reported figures, not ours, and they are only as good as
              how often staff type them in. */}
          <p className="text-[11px] text-slate-400 mb-1">
            Typed in by staff at the till, so only as complete as the capture
            rate below.
          </p>
          <dl className="divide-y divide-slate-100 text-sm">
            <Row
              label={`Captured, last ${detail.thresholds.windowDays} days`}
              value={money(m.revenueCentsWindow)}
            />
            <Row label="Captured, all time" value={money(m.revenueCentsTotal)} />
            <Row
              label="Capture rate"
              value={
                m.capturableWindow === 0
                  ? "—"
                  : `${Math.round((m.capturedWindow / m.capturableWindow) * 100)}%`
              }
              hint={`${m.capturedWindow} of ${m.capturableWindow} scans carried an amount`}
            />
            <Row
              label="Sales per reward"
              value={m.salesPerRewardCents === null ? "—" : money(m.salesPerRewardCents)}
              hint="captured sales ÷ rewards given, all time"
            />
          </dl>
        </section>
      </div>

      <div className="grid lg:grid-cols-3 gap-4 mt-4">
        <section className="rounded-xl bg-white border border-slate-200 p-5 lg:col-span-2">
          <h2 className="text-sm font-medium text-slate-900">
            Scans, last {detail.thresholds.windowDays} days
          </h2>
          <div className="mt-4 flex items-end gap-0.5 h-28">
            {detail.daily.map((d) => (
              <div
                key={d.date}
                title={`${d.date}: ${d.events} scan${d.events === 1 ? "" : "s"}`}
                className="flex-1 bg-slate-200 rounded-t hover:bg-slate-400 transition-colors"
                style={{ height: `${Math.max(2, (d.events / maxDay) * 100)}%` }}
              />
            ))}
          </div>
          <p className="text-[11px] text-slate-400 mt-2">
            {detail.daily[0]?.date} → {detail.daily[detail.daily.length - 1]?.date}, in the
            café&apos;s own timezone. Peak {maxDay}/day.
          </p>
        </section>

        <section className="rounded-xl bg-white border border-slate-200 p-5">
          <h2 className="text-sm font-medium text-slate-900">Customer mix</h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            {classified} with at least one visit. Same buckets the café sees.
          </p>
          {classified === 0 ? (
            <p className="text-sm text-slate-600 mt-3">Nobody has visited yet.</p>
          ) : (
            <ul className="mt-3 space-y-1.5 text-sm">
              {detail.segments.map((s) => (
                <li key={s.segment} className="flex items-center justify-between gap-2">
                  <span className="text-slate-600">{SEGMENT_LABEL[s.segment]}</span>
                  <span className="tabular-nums text-slate-900">
                    {s.customers}
                    {s.revenueCents > 0 && (
                      <span className="text-slate-400"> · {money(s.revenueCents)}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="rounded-xl bg-white border border-slate-200 p-5 mt-4">
        <h2 className="text-sm font-medium text-slate-900">
          Programs <span className="text-slate-400">({detail.programs.length})</span>
        </h2>
        {detail.programs.length === 0 ? (
          <p className="text-sm text-slate-600 mt-2">
            No programs yet — this café has nothing for customers to join.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {detail.programs.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm border-t border-slate-100 pt-2 first:border-0 first:pt-0"
              >
                <span className="font-medium text-slate-900">{p.name}</span>
                <span className="text-[11px] rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
                  {p.programType}
                </span>
                {!p.active && (
                  <span className="text-[11px] text-amber-700">inactive</span>
                )}
                <span className="text-slate-600">{p.rewardText}</span>
                <span className="ml-auto text-slate-500 tabular-nums">{p.cards} cards</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl bg-white border border-slate-200 p-5 mt-4">
        <h2 className="text-sm font-medium text-slate-900">Recent activity</h2>
        {detail.recentEvents.length === 0 ? (
          <p className="text-sm text-slate-600 mt-2">Nothing has happened on this account yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 text-sm">
            {detail.recentEvents.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 py-1.5">
                <span className="text-slate-900">
                  {EVENT_LABEL[e.eventType] ?? e.eventType}
                </span>
                <span className="text-slate-600">{e.customerName ?? "Unnamed customer"}</span>
                <span className="text-[11px] text-slate-400">{e.programName}</span>
                {e.note ? <span className="text-[11px] text-slate-500">{e.note}</span> : null}
                <span className="ml-auto text-slate-500 tabular-nums whitespace-nowrap">
                  {e.amountCents !== null && <>{money(e.amountCents)} · </>}
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
