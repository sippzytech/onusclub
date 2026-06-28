import Link from "next/link";
import type { Card, Customer, Program } from "@onusclub/shared";
import { apiFetch } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { DashboardShell } from "./dashboard-shell";

export const dynamic = "force-dynamic";

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

interface StatCardProps {
  label: string;
  value: string;
  delta?: { value: string; positive?: boolean } | null;
}
function StatCard({ label, value, delta }: StatCardProps): JSX.Element {
  return (
    <div className="rounded-card bg-white border border-brand-green/10 p-5 min-w-0">
      <p className="text-sm text-brand-olive">{label}</p>
      <p className="font-serif text-3xl text-brand-green mt-3 tabular-nums">{value}</p>
      {delta ? (
        <p
          className={
            "text-xs mt-2 flex items-center gap-1 " +
            (delta.positive === false ? "text-red-700" : "text-emerald-700")
          }
        >
          <span aria-hidden="true">{delta.positive === false ? "↓" : "↑"}</span>
          {delta.value}
        </p>
      ) : null}
    </div>
  );
}

export default async function DashboardPage(): Promise<JSX.Element> {
  const { jwt, user, merchant, preferences } = await requireSession();

  // Pull the shapes we already have; aggregate to dashboard-shaped numbers
  // client-side so we don't have to add a new endpoint yet.
  const [{ programs }, { customers }, { cards }] = await Promise.all([
    apiFetch<{ programs: Program[] }>("/v1/programs", { jwt }),
    apiFetch<{ customers: Customer[] }>("/v1/customers", { jwt }),
    apiFetch<{ cards: Card[] }>("/v1/cards", { jwt }),
  ]);

  // Headline numbers — derived from current snapshot. Time-windowed numbers
  // (this week, vs last month) need a dedicated aggregation endpoint —
  // showing a "—" delta until that lands rather than a fake number.
  const activeMembers = customers.length;
  const activeCards = cards.filter((c) => c.status === "active").length;
  const totalStamps = cards.reduce((acc, c) => {
    const state = (c.cardState ?? {}) as { total_lifetime?: number };
    return acc + (state.total_lifetime ?? 0);
  }, 0);
  const totalRewards = cards.reduce((acc, c) => {
    const state = (c.cardState ?? {}) as { rewards_redeemed?: number };
    return acc + (state.rewards_redeemed ?? 0);
  }, 0);
  const repeatRate =
    activeMembers > 0 && totalStamps > 0
      ? Math.round((totalStamps / activeMembers) * 10) / 10
      : 0;

  // "Recent activity" — pull each card's last event timestamp from
  // last_event_at and surface the most recent few. Sorted desc.
  const recentCards = [...cards]
    .filter((c) => c.lastEventAt)
    .sort(
      (a, b) =>
        new Date(b.lastEventAt!).getTime() - new Date(a.lastEventAt!).getTime()
    )
    .slice(0, 6);

  function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60_000);
    if (m < 1) return "now";
    if (m < 60) return `${m} min ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} hr ago`;
    const d = Math.floor(h / 24);
    return `${d} day${d === 1 ? "" : "s"} ago`;
  }

  function avatarColorFor(name: string): string {
    // Stable color picker per customer initial. Matches the muted palette
    // used in the mocks (forest, olive, brown, indigo).
    const palette = [
      "bg-brand-green",
      "bg-brand-olive",
      "bg-[#3d2a1f]",
      "bg-[#3a4d3f]",
      "bg-[#5b4332]",
      "bg-[#2f3a4d]",
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) & 0xff;
    return palette[hash % palette.length];
  }
  function initialsFor(name: string | null): string {
    if (!name) return "?";
    return name
      .split(/\s+/)
      .map((s) => s[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
  }

  return (
    <DashboardShell
      user={user}
      merchant={merchant}
      isPremium={preferences.isPremium}
      breadcrumb={`${merchant.businessName} · Dashboard`}
      title="Overview"
    >
      <div className="space-y-6">
        {/* KPI row */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
          <StatCard label="Active members" value={formatNumber(activeMembers)} />
          <StatCard label="Active cards" value={formatNumber(activeCards)} />
          <StatCard label="Stamps issued" value={formatNumber(totalStamps)} />
          <StatCard label="Rewards redeemed" value={formatNumber(totalRewards)} />
          <StatCard
            label="Avg stamps / member"
            value={activeMembers > 0 ? repeatRate.toFixed(1) : "—"}
          />
        </div>

        {/* Main row: chart + activity */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
          {/* Chart card (placeholder — wire to a real time-series later) */}
          <div className="xl:col-span-2 rounded-card bg-white border border-brand-green/10 p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-serif text-2xl text-brand-green">
                  Visits &amp; stamps
                </h2>
                <p className="text-sm text-brand-olive mt-1">
                  Lifetime totals across all programs
                </p>
              </div>
              <div className="inline-flex rounded-full bg-brand-cream p-1 text-xs">
                {(["12w", "30d", "7d"] as const).map((r, i) => (
                  <button
                    key={r}
                    type="button"
                    className={
                      "px-3 py-1 rounded-full " +
                      (i === 0
                        ? "bg-brand-green text-white"
                        : "text-brand-olive hover:text-brand-green")
                    }
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
            {/* Static visual placeholder for the time series — real chart
             * follows when /v1/analytics/timeseries lands. */}
            <div className="mt-6 h-64 relative">
              <svg viewBox="0 0 600 200" className="w-full h-full" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#B0894F" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="#B0894F" stopOpacity="0.02" />
                  </linearGradient>
                </defs>
                <path
                  d="M0,160 L50,150 100,155 150,140 200,135 250,120 300,118 350,100 400,90 450,80 500,60 550,50 600,40 L600,200 L0,200 Z"
                  fill="url(#g)"
                />
                <path
                  d="M0,160 L50,150 100,155 150,140 200,135 250,120 300,118 350,100 400,90 450,80 500,60 550,50 600,40"
                  fill="none"
                  stroke="#B0894F"
                  strokeWidth="2"
                />
              </svg>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-4 pt-4 border-t border-brand-green/10">
              <div>
                <p className="text-xs uppercase tracking-wide text-brand-olive">New members</p>
                <p className="font-serif text-2xl text-brand-green mt-1 tabular-nums">
                  +{customers.filter((c) => {
                    const days = (Date.now() - new Date(c.createdAt).getTime()) / 86_400_000;
                    return days < 30;
                  }).length}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-brand-olive">Total programs</p>
                <p className="font-serif text-2xl text-brand-green mt-1 tabular-nums">
                  {programs.length}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-brand-olive">Reward rate</p>
                <p className="font-serif text-2xl text-brand-green mt-1 tabular-nums">
                  {totalStamps > 0
                    ? `${Math.round((totalRewards / totalStamps) * 100)}%`
                    : "—"}
                </p>
              </div>
            </div>
          </div>

          {/* Recent activity */}
          <div className="rounded-card bg-white border border-brand-green/10 p-6">
            <div className="flex items-start justify-between gap-3">
              <h2 className="font-serif text-2xl text-brand-green">Recent activity</h2>
              <span className="inline-flex items-center gap-1.5 text-xs text-brand-olive">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Live
              </span>
            </div>
            {recentCards.length === 0 ? (
              <p className="text-sm text-brand-olive mt-4">
                No activity yet. Enrol a customer to get started.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-brand-green/10">
                {recentCards.map((c) => {
                  const name = c.customerName ?? "Member";
                  const initials = initialsFor(name);
                  const color = avatarColorFor(name);
                  return (
                    <li key={c.id} className="flex items-start gap-3 py-3">
                      <div
                        className={
                          "h-8 w-8 rounded-md text-white text-xs font-medium flex items-center justify-center shrink-0 " +
                          color
                        }
                      >
                        {initials}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-brand-green">
                          <Link
                            href={`/dashboard/cards/${c.id}`}
                            className="font-medium hover:underline underline-offset-2"
                          >
                            {name}
                          </Link>{" "}
                          <span className="text-brand-olive">
                            on {c.programName}
                          </span>
                        </p>
                        <p className="text-xs text-brand-olive mt-0.5">
                          {timeAgo(c.lastEventAt!)}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {programs.length === 0 ? (
          <div className="rounded-card bg-white border border-brand-green/10 p-8 text-center">
            <p className="font-serif text-2xl text-brand-green">No programs yet</p>
            <p className="text-sm text-brand-olive mt-2 max-w-md mx-auto">
              Create your first loyalty program to start enrolling customers
              and issuing digital cards.
            </p>
            <Link
              href="/dashboard/card-builder"
              className="mt-5 inline-block rounded-full bg-brand-green text-white text-sm font-medium px-5 py-2.5 hover:bg-brand-green-deep transition-colors"
            >
              Go to Card builder
            </Link>
          </div>
        ) : null}
      </div>
    </DashboardShell>
  );
}
