import Link from "next/link";
import {
  centsToEuroString,
  primaryHealthFlag,
  type AdminMerchantList,
  type AdminPlatformMetrics,
} from "@onusclub/shared";
import { apiFetch } from "@/lib/api";
import { requireAdminSession } from "@/lib/admin-session";
import { AdminShell } from "./admin-shell";
import { FLAG_COPY, HealthBadge } from "./health-badge";

export const dynamic = "force-dynamic";

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}): JSX.Element {
  return (
    <div className="rounded-xl bg-white border border-slate-200 px-4 py-3">
      <p className="text-[11px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className="text-2xl text-slate-900 tabular-nums mt-1">{value}</p>
      {hint ? <p className="text-[11px] text-slate-500 mt-0.5">{hint}</p> : null}
    </div>
  );
}

export default async function AdminOverviewPage(): Promise<JSX.Element> {
  const { jwt, admin } = await requireAdminSession();

  const [metrics, list] = await Promise.all([
    apiFetch<AdminPlatformMetrics>("/v1/admin/metrics", { jwt }),
    apiFetch<AdminMerchantList>("/v1/admin/merchants?sort=attention", { jwt }),
  ]);

  const pct = (part: number, whole: number): string =>
    whole === 0 ? "—" : `${Math.round((part / whole) * 100)}%`;

  // Only the cafés that actually need something. "Healthy" and "onboarding"
  // are not problems, and listing them here would bury the ones that are.
  const needsAttention = list.merchants.filter((m) => {
    const flag = primaryHealthFlag(m.flags);
    return flag !== "healthy" && flag !== "onboarding";
  });

  const maxWeek = Math.max(...metrics.signupsByWeek.map((w) => w.merchants), 1);

  return (
    <AdminShell admin={admin} breadcrumb="Platform" title="Overview">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat
          label="Cafés"
          value={String(metrics.merchants.total)}
          hint={`${metrics.merchants.active} active · ${metrics.merchants.trial} trial${
            metrics.merchants.suspended > 0
              ? ` · ${metrics.merchants.suspended} suspended`
              : ""
          }`}
        />
        <Stat
          label="Recorded MRR"
          value={centsToEuroString(metrics.revenue.mrrCents)}
          // Stated, not implied. With no billing integration this total is only
          // as complete as what has been typed in, and a bare figure would read
          // as the whole picture.
          hint={
            metrics.revenue.feeUnset > 0
              ? `${metrics.revenue.feeSet} with a fee set · ${metrics.revenue.feeUnset} not recorded`
              : `${metrics.revenue.feeSet} cafés`
          }
        />
        <Stat
          label="Customers"
          value={String(metrics.usage.customers)}
          hint={`${metrics.usage.cards} cards issued`}
        />
        <Stat
          label="Wallet adoption"
          value={pct(metrics.usage.walletCards, metrics.usage.cards)}
          hint={`${metrics.usage.googlePasses} Google · ${metrics.usage.applePasses} Apple`}
        />
      </div>

      <div className="grid lg:grid-cols-3 gap-4 mt-4">
        <section className="rounded-xl bg-white border border-slate-200 p-5">
          <h2 className="text-sm font-medium text-slate-900">Activity</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-slate-600">Scans, last 30 days</dt>
              <dd className="tabular-nums text-slate-900">{metrics.usage.eventsWindow}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-600">Scans, all time</dt>
              <dd className="tabular-nums text-slate-900">{metrics.usage.eventsTotal}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-600">Trials ending within 7 days</dt>
              <dd className="tabular-nums text-slate-900">
                {metrics.merchants.trialsEndingSoon}
              </dd>
            </div>
            <div className="flex justify-between gap-2 pt-2 border-t border-slate-100">
              <dt className="text-slate-600">
                Customer spend captured
                <span className="block text-[11px] text-slate-400">
                  across all cafés, last 30 days — their sales, not our revenue
                </span>
              </dt>
              <dd className="tabular-nums text-slate-900">
                {centsToEuroString(metrics.usage.merchantRevenueCentsWindow)}
              </dd>
            </div>
          </dl>
        </section>

        <section className="rounded-xl bg-white border border-slate-200 p-5">
          <h2 className="text-sm font-medium text-slate-900">Health</h2>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Each café counted once, under its most serious flag.
          </p>
          <ul className="mt-3 space-y-1.5">
            {metrics.health
              .filter((h) => h.merchants > 0)
              .map((h) => (
                <li key={h.flag} className="flex items-center justify-between gap-2">
                  <Link href={`/admin/merchants?flag=${h.flag}`} className="hover:opacity-70">
                    <HealthBadge flag={h.flag} />
                  </Link>
                  <span className="text-sm tabular-nums text-slate-900">{h.merchants}</span>
                </li>
              ))}
          </ul>
        </section>

        <section className="rounded-xl bg-white border border-slate-200 p-5">
          <h2 className="text-sm font-medium text-slate-900">Signups</h2>
          <p className="text-[11px] text-slate-500 mt-0.5">New cafés per week, last 12 weeks.</p>
          <div className="mt-4 flex items-end gap-1 h-24">
            {metrics.signupsByWeek.map((w) => (
              <div
                key={w.weekStart}
                title={`Week of ${w.weekStart}: ${w.merchants}`}
                className="flex-1 bg-slate-200 rounded-t hover:bg-slate-300 transition-colors"
                // Zero weeks keep a 2px stub so the axis reads as continuous
                // rather than as missing data.
                style={{ height: `${Math.max(2, (w.merchants / maxWeek) * 100)}%` }}
              />
            ))}
          </div>
          <p className="text-[11px] text-slate-400 mt-2">
            {metrics.signupsByWeek[0]?.weekStart} →{" "}
            {metrics.signupsByWeek[metrics.signupsByWeek.length - 1]?.weekStart}
          </p>
        </section>
      </div>

      <section className="mt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-serif text-xl text-slate-900">Needs attention</h2>
          <Link href="/admin/merchants" className="text-sm text-slate-600 underline">
            All {list.merchants.length} cafés
          </Link>
        </div>

        {needsAttention.length === 0 ? (
          <p className="text-sm text-slate-600 mt-3">
            Nothing flagged. Every café is either active or still onboarding.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {needsAttention.slice(0, 12).map((m) => {
              const flag = primaryHealthFlag(m.flags);
              return (
                <li key={m.id}>
                  <Link
                    href={`/admin/merchants/${m.id}`}
                    className="block rounded-xl bg-white border border-slate-200 px-4 py-3 hover:border-slate-400 transition-colors"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-900">{m.businessName}</span>
                      <HealthBadge flag={flag} />
                      {m.flags
                        .filter((f) => f !== flag)
                        .map((f) => (
                          <HealthBadge key={f} flag={f} className="opacity-60" />
                        ))}
                      <span className="ml-auto text-xs text-slate-500 tabular-nums">
                        {m.customers} customer{m.customers === 1 ? "" : "s"}
                        {m.daysSinceLastEvent !== null && ` · last scan ${m.daysSinceLastEvent}d ago`}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 mt-1">{FLAG_COPY[flag].action}</p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </AdminShell>
  );
}
