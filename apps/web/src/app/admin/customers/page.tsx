import Link from "next/link";
import type { AdminCustomerSearch, CustomerIdentity } from "@onusclub/shared";
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

  // The cross-café view, derived from the same search term. Only fetched for
  // a text query: "every customer of one café" is the list below, not an
  // identity question.
  //
  // Allowed to fail so the page still renders if migration 019 has not run.
  let identities: CustomerIdentity[] = [];
  if (q.length >= 2) {
    const res = await apiFetch<{ identities: CustomerIdentity[] }>(
      `/v1/admin/customers/identities/search?q=${encodeURIComponent(q)}`,
      { jwt }
    ).catch(() => null);
    // Only the people who actually appear at more than one café. Everyone
    // else is already one row in the list below, and repeating them here
    // would bury the handful of rows this panel exists to surface.
    identities = (res?.identities ?? []).filter((i) => i.cafes.length > 1);
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

      {identities.length > 0 ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5 mb-5">
          <h2 className="text-sm font-medium text-slate-900">
            Same person, more than one café
          </h2>
          <p className="text-[11px] text-slate-500 mt-0.5 mb-3">
            Matched on email or phone across tenants. Derived at query time —
            there is no master customer record, so deleting a café removes its
            copy of the person and this view simply stops showing it.
          </p>
          <ul className="space-y-3">
            {identities.map((p) => (
              <li key={p.key} className="text-sm">
                <p className="font-medium text-slate-900">
                  {p.name ?? "(no name)"}{" "}
                  <span className="font-normal text-slate-500">
                    {p.email ?? p.phone ?? ""}
                  </span>
                </p>
                <ul className="mt-1 flex flex-wrap gap-2">
                  {p.cafes.map((c) => (
                    <li
                      key={c.customerId}
                      className={
                        "rounded-full border px-2.5 py-1 text-xs " +
                        (c.blocked
                          ? "border-red-300 bg-red-50 text-red-800"
                          : "border-slate-200 bg-slate-50 text-slate-700")
                      }
                    >
                      <Link href={`/admin/customers/${c.customerId}`} className="hover:underline">
                        {c.businessName}
                      </Link>
                      {c.blocked ? (
                        <span className="ml-1 font-medium">· blocked</span>
                      ) : (
                        <span className="ml-1 text-slate-500">
                          · {c.activeCards} card{c.activeCards === 1 ? "" : "s"}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

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
