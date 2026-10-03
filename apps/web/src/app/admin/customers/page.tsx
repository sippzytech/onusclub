import Link from "next/link";
import type { AdminCustomerSearch } from "@onusclub/shared";
import { apiFetch } from "@/lib/api";
import { requireAdminSession } from "@/lib/admin-session";
import { AdminShell } from "../admin-shell";

export const dynamic = "force-dynamic";

export default async function AdminCustomerSearchPage({
  searchParams,
}: {
  searchParams: { q?: string; merchantId?: string };
}): Promise<JSX.Element> {
  const { jwt, admin } = await requireAdminSession();

  const q = searchParams.q?.trim() ?? "";
  const merchantId = searchParams.merchantId ?? "";

  // No query, no search. An empty term across every tenant would mean
  // selecting the whole customer table, so the api refuses it and the page
  // does not ask.
  let result: AdminCustomerSearch | null = null;
  if (q.length >= 2 || merchantId) {
    const query = new URLSearchParams();
    if (q) query.set("q", q);
    if (merchantId) query.set("merchantId", merchantId);
    result = await apiFetch<AdminCustomerSearch>(`/v1/admin/customers?${query.toString()}`, {
      jwt,
    });
  }

  return (
    <AdminShell admin={admin} breadcrumb="Platform" title="Find a customer">
      <form method="GET" className="flex flex-wrap items-end gap-2 mb-5">
        <label className="text-xs text-slate-600">
          <span className="block mb-1">Name, email or phone</span>
          <input
            type="search"
            name="q"
            defaultValue={q}
            autoFocus
            placeholder="at least 2 characters"
            className="w-80 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
          />
        </label>
        {merchantId ? <input type="hidden" name="merchantId" value={merchantId} /> : null}
        <button type="submit" className="rounded-lg bg-slate-900 text-white px-4 py-2 text-sm">
          Search
        </button>
      </form>

      {merchantId ? (
        <p className="text-sm text-slate-700 mb-3">
          Limited to one café.{" "}
          <Link href="/admin/customers" className="underline">
            Search everywhere instead
          </Link>
        </p>
      ) : null}

      {result === null ? (
        <p className="text-sm text-slate-600">
          Searches across every café. Useful when a café writes in about one
          customer and you only have a name.
        </p>
      ) : result.customers.length === 0 ? (
        <p className="text-sm text-slate-600">
          Nothing matches {q ? <strong>{q}</strong> : "that café"}.
        </p>
      ) : (
        <>
          <p className="text-xs text-slate-500 mb-2">
            {result.customers.length} match{result.customers.length === 1 ? "" : "es"}
            {/* Stated, because quietly showing the first 50 of 900 would be
                a lie by omission. */}
            {result.truncated && " — showing the first 50, narrow the search to see more"}
          </p>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left">
                <tr className="text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-2 font-medium">Customer</th>
                  <th className="px-3 py-2 font-medium">Café</th>
                  <th className="px-3 py-2 font-medium text-right">Cards</th>
                  <th className="px-3 py-2 font-medium text-right">Visits</th>
                  <th className="px-3 py-2 font-medium text-right">Last visit</th>
                </tr>
              </thead>
              <tbody>
                {result.customers.map((c) => (
                  <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/admin/customers/${c.id}`}
                        className="font-medium text-slate-900 hover:underline"
                      >
                        {c.name ?? "Unnamed"}
                      </Link>
                      <span className="block text-[11px] text-slate-500">
                        {[c.email, c.phone].filter(Boolean).join(" · ") || "no contact details"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <Link
                        href={`/admin/merchants/${c.merchantId}`}
                        className="text-slate-700 hover:underline"
                      >
                        {c.merchantName}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                      {c.cards}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                      {c.visits}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
                      {c.lastVisitAt ? c.lastVisitAt.slice(0, 10) : "never"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </AdminShell>
  );
}
