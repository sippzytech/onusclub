import Link from "next/link";
import {
  AdminHealthFlag,
  centsToEuroString,
  primaryHealthFlag,
  type AdminMerchantList,
} from "@onusclub/shared";
import { apiFetch } from "@/lib/api";
import { requireAdminSession } from "@/lib/admin-session";
import { AdminShell } from "../admin-shell";
import { HealthBadge } from "../health-badge";

export const dynamic = "force-dynamic";

const SORTS: Array<{ value: string; label: string }> = [
  { value: "attention", label: "Needs attention" },
  { value: "newest", label: "Newest" },
  { value: "customers", label: "Most customers" },
  { value: "revenue", label: "Most sales (30d)" },
  { value: "fee", label: "Highest fee" },
  { value: "name", label: "Name" },
];

/** Dash, not a zero — "not recorded" and "zero" are different facts. */
function fee(cents: number | null): string {
  return cents === null ? "—" : centsToEuroString(cents);
}

function ratio(part: number, whole: number): string {
  if (whole === 0) return "—";
  return `${Math.round((part / whole) * 100)}%`;
}

export default async function AdminMerchantsPage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string; flag?: string; sort?: string };
}): Promise<JSX.Element> {
  const { jwt, admin } = await requireAdminSession();

  // Forwarded rather than reconstructed, so filtering stays one implementation
  // in the api instead of two that can disagree.
  const query = new URLSearchParams();
  if (searchParams.q) query.set("q", searchParams.q);
  if (searchParams.status) query.set("status", searchParams.status);
  if (searchParams.flag) query.set("flag", searchParams.flag);
  query.set("sort", searchParams.sort ?? "attention");

  const list = await apiFetch<AdminMerchantList>(`/v1/admin/merchants?${query.toString()}`, {
    jwt,
  });

  const parsedFlag = AdminHealthFlag.safeParse(searchParams.flag);
  const activeFlag = parsedFlag.success ? parsedFlag.data : null;

  return (
    <AdminShell admin={admin} breadcrumb="Platform" title="Cafés">
      {/* A GET form, so every view is a shareable URL and the back button
          works. No client state needed for three filters. */}
      <form method="GET" className="flex flex-wrap items-end gap-2 mb-4">
        <label className="text-xs text-slate-600">
          <span className="block mb-1">Search</span>
          <input
            type="search"
            name="q"
            defaultValue={searchParams.q ?? ""}
            placeholder="name, owner email or slug"
            className="w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
          />
        </label>
        <label className="text-xs text-slate-600">
          <span className="block mb-1">Status</span>
          <select
            name="status"
            defaultValue={searchParams.status ?? ""}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 bg-white"
          >
            <option value="">Any</option>
            <option value="trial">Trial</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
        </label>
        <label className="text-xs text-slate-600">
          <span className="block mb-1">Sort</span>
          <select
            name="sort"
            defaultValue={searchParams.sort ?? "attention"}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 bg-white"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        {searchParams.flag ? (
          <input type="hidden" name="flag" value={searchParams.flag} />
        ) : null}
        <button
          type="submit"
          className="rounded-lg bg-slate-900 text-white px-4 py-2 text-sm"
        >
          Apply
        </button>
        {(searchParams.q || searchParams.status || searchParams.flag) && (
          <Link href="/admin/merchants" className="text-sm text-slate-600 underline py-2">
            Clear
          </Link>
        )}
      </form>

      {/* Parsed rather than cast: the value comes straight from the query
          string, and an unknown flag would index FLAG_COPY to undefined and
          crash the render. */}
      {activeFlag ? (
        <p className="text-sm text-slate-700 mb-3">
          Filtered to cafés flagged <HealthBadge flag={activeFlag} />.
        </p>
      ) : null}

      <p className="text-xs text-slate-500 mb-2">
        {list.merchants.length} café{list.merchants.length === 1 ? "" : "s"}. &ldquo;Dormant&rdquo;
        means no scans for {list.thresholds.dormantDays} days; sales, scans and capture are the
        last {list.thresholds.windowDays} days; dead enrolments count cards older than{" "}
        {list.thresholds.cardMaturityDays} days that were never used.
      </p>

      {/* Wide table, so it scrolls inside its own container rather than
          pushing the page sideways. */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left">
            <tr className="text-[11px] uppercase tracking-wider text-slate-500">
              <th className="px-4 py-2 font-medium">Café</th>
              <th className="px-3 py-2 font-medium">Health</th>
              <th className="px-3 py-2 font-medium text-right">Fee</th>
              <th className="px-3 py-2 font-medium text-right">Customers</th>
              <th className="px-3 py-2 font-medium text-right">Wallet</th>
              <th className="px-3 py-2 font-medium text-right">Scans 30d</th>
              <th className="px-3 py-2 font-medium text-right">Sales 30d</th>
              <th className="px-3 py-2 font-medium text-right">Capture</th>
              <th className="px-3 py-2 font-medium text-right">Per reward</th>
              <th className="px-3 py-2 font-medium text-right">Last scan</th>
            </tr>
          </thead>
          <tbody>
            {list.merchants.map((m) => (
              <tr key={m.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-2.5">
                  <Link
                    href={`/admin/merchants/${m.id}`}
                    className="font-medium text-slate-900 hover:underline"
                  >
                    {m.businessName}
                  </Link>
                  <span className="block text-[11px] text-slate-500">{m.ownerEmail}</span>
                </td>
                <td className="px-3 py-2.5">
                  <HealthBadge flag={primaryHealthFlag(m.flags)} />
                  {m.status === "suspended" && (
                    <span className="block text-[11px] text-red-700 mt-0.5">suspended</span>
                  )}
                  {m.trial.expired && m.status !== "suspended" && (
                    <span className="block text-[11px] text-amber-700 mt-0.5">trial ended</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                  {fee(m.monthlyFeeCents)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                  {m.customers}
                </td>
                <td
                  className="px-3 py-2.5 text-right tabular-nums text-slate-700"
                  title={`${m.walletCards} of ${m.cards} cards saved to a phone`}
                >
                  {ratio(m.walletCards, m.cards)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                  {m.eventsWindow}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                  {m.revenueCentsWindow > 0
                    ? centsToEuroString(m.revenueCentsWindow, m.currencyCode)
                    : "—"}
                </td>
                <td
                  className="px-3 py-2.5 text-right tabular-nums text-slate-700"
                  title={`${m.capturedWindow} of ${m.capturableWindow} scans carried a sale amount`}
                >
                  {ratio(m.capturedWindow, m.capturableWindow)}
                </td>
                <td
                  className="px-3 py-2.5 text-right tabular-nums text-slate-700"
                  title="Captured sales per reward redeemed, all time"
                >
                  {m.salesPerRewardCents === null
                    ? "—"
                    : centsToEuroString(m.salesPerRewardCents, m.currencyCode)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                  {m.daysSinceLastEvent === null ? "never" : `${m.daysSinceLastEvent}d`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {list.merchants.length === 0 && (
        <p className="text-sm text-slate-600 mt-4">No cafés match those filters.</p>
      )}
    </AdminShell>
  );
}
