import Link from "next/link";
import {
  AnalyticsRange,
  centsToEuroString,
  type AnalyticsDetail,
  type RfmOverview,
} from "@onusclub/shared";
import { apiFetch } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { DashboardShell } from "../dashboard-shell";
import { HourBars, NewVsReturning, TopList, TrendChart } from "./charts";
import { Segments } from "./segments";

export const dynamic = "force-dynamic";

const RANGES: Array<{ value: AnalyticsRange; label: string }> = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "12m", label: "12 months" },
];

function StatCard({ label, value, hint }: {
  label: string;
  value: string;
  hint?: string;
}): JSX.Element {
  return (
    <div className="rounded-card bg-white border border-brand-green/10 p-5 min-w-0">
      <p className="text-sm text-brand-olive">{label}</p>
      <p className="font-serif text-3xl text-brand-green mt-3 tabular-nums">{value}</p>
      {hint ? <p className="text-xs text-brand-olive mt-2">{hint}</p> : null}
    </div>
  );
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: { range?: string };
}): Promise<JSX.Element> {
  const { jwt, user, merchant, preferences, trial } = await requireSession();

  // Unknown or absent values fall back to 30d rather than erroring — this is a
  // URL a human can type.
  const range = AnalyticsRange.catch("30d").parse(searchParams.range);

  // Segments are deliberately not range-scoped — recency only means
  // something measured from now — so they are a separate fetch.
  const [detail, segments] = await Promise.all([
    apiFetch<AnalyticsDetail>(`/v1/analytics/detail?range=${range}`, { jwt }),
    apiFetch<RfmOverview>("/v1/analytics/segments", { jwt }),
  ]);

  const money = (cents: number): string =>
    centsToEuroString(cents, detail.currencyCode);

  // Revenue capture is optional per scan, so "no revenue" is an ordinary state
  // and not an error. Say why it is empty instead of drawing a confident zero.
  const hasRevenue = detail.totalRevenueCents > 0;
  const hasVisits = detail.totalVisits > 0;

  return (
    <DashboardShell
      trial={trial}
      user={user}
      merchant={merchant}
      isPremium={preferences.isPremium}
      breadcrumb={`${merchant.businessName} · Analytics`}
      title="Analytics"
    >
      <div className="space-y-6 max-w-5xl">
        <nav className="flex flex-wrap gap-2" aria-label="Date range">
          {RANGES.map((r) => {
            const active = r.value === range;
            return (
              <Link
                key={r.value}
                href={`/dashboard/analytics?range=${r.value}`}
                aria-current={active ? "page" : undefined}
                className={
                  "px-4 py-2 rounded-full text-sm border transition-colors " +
                  (active
                    ? "bg-brand-green text-brand-cream border-brand-green"
                    : "bg-white text-brand-olive border-brand-green/15 hover:border-brand-green/40")
                }
              >
                {r.label}
              </Link>
            );
          })}
        </nav>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            label="Visits"
            value={detail.totalVisits.toLocaleString("en-US")}
            hint="Stamps and points transactions"
          />
          <StatCard
            label="Revenue"
            value={hasRevenue ? money(detail.totalRevenueCents) : "—"}
            hint={hasRevenue ? undefined : "From sale amounts typed at scan time"}
          />
          <StatCard
            label="Average sale"
            value={detail.aovCents === null ? "—" : money(detail.aovCents)}
            hint={detail.aovCents === null ? "Needs at least one captured amount" : undefined}
          />
        </div>

        <Segments data={segments} />

        {!hasVisits ? (
          <div className="rounded-card bg-white border border-brand-green/10 p-10 text-center">
            <p className="font-serif text-2xl text-brand-green">No activity yet</p>
            <p className="text-sm text-brand-olive mt-3 max-w-md mx-auto">
              Once customers start scanning, this page fills in — visits over time,
              your busiest hours, and who your best members are. Try a longer date
              range if you have older activity.
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <TrendChart
                title="Visits"
                series={detail.series.map((d) => ({ date: d.date, value: d.visits }))}
                format={(v) => v.toLocaleString("en-US")}
              />
              <TrendChart
                title="Revenue"
                series={detail.series.map((d) => ({ date: d.date, value: d.revenueCents }))}
                format={money}
                accent="#B0894F"
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <HourBars hours={detail.hours} timezone={detail.timezone} />
              <NewVsReturning
                newCards={detail.newCards}
                returningCards={detail.returningCards}
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <TopList
                title="Top members by visits"
                members={detail.topByVisits}
                metric="visits"
                currencyCode={detail.currencyCode}
              />
              <TopList
                title="Top members by spend"
                members={detail.topByRevenue}
                metric="revenue"
                currencyCode={detail.currencyCode}
              />
            </div>

            {!hasRevenue ? (
              <p className="text-xs text-brand-olive">
                Revenue is blank because no sale amounts have been captured in this
                period. Staff can type the amount when scanning, or on the stamp and
                redeem buttons on a card — it is always optional.
              </p>
            ) : null}
          </>
        )}
      </div>
    </DashboardShell>
  );
}
