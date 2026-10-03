import Link from "next/link";
import type { AdminAuditLog } from "@onusclub/shared";
import { apiFetch } from "@/lib/api";
import { requireAdminSession } from "@/lib/admin-session";
import { AdminShell } from "../admin-shell";

export const dynamic = "force-dynamic";

const ACTION_LABEL: Record<string, string> = {
  "card.adjust": "Balance adjusted",
  "merchant.update": "Account changed",
  "merchant.password_reset": "Reset link sent",
};

/**
 * Render a before/after pair as the diff it is, rather than two JSON blobs the
 * reader has to compare by eye. Only keys that actually changed are shown.
 */
function Diff({ before, after }: { before: unknown; after: unknown }): JSX.Element | null {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)])).filter(
    (k) => JSON.stringify(b[k]) !== JSON.stringify(a[k])
  );
  if (keys.length === 0) return null;

  const show = (v: unknown): string =>
    v === null || v === undefined ? "—" : typeof v === "string" ? v : JSON.stringify(v);

  return (
    <ul className="text-[11px] text-slate-600 space-y-0.5 mt-1">
      {keys.map((k) => (
        <li key={k}>
          <span className="text-slate-400">{k}:</span> {show(b[k])} →{" "}
          <span className="text-slate-900">{show(a[k])}</span>
        </li>
      ))}
    </ul>
  );
}

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: { merchantId?: string; action?: string };
}): Promise<JSX.Element> {
  const { jwt, admin } = await requireAdminSession();

  const query = new URLSearchParams();
  if (searchParams.merchantId) query.set("merchantId", searchParams.merchantId);
  if (searchParams.action) query.set("action", searchParams.action);

  const log = await apiFetch<AdminAuditLog>(
    `/v1/admin/audit${query.toString() ? `?${query.toString()}` : ""}`,
    { jwt }
  );

  return (
    <AdminShell admin={admin} breadcrumb="Platform" title="Audit log">
      <p className="text-sm text-slate-600 mb-4 max-w-2xl">
        Every write the platform-admin dashboard has made. Append-only — there is no edit or
        delete path, from here or from the API.
        {/* The honest caveat about which layer matters. */}
        <span className="block text-xs text-slate-500 mt-1">
          Balance adjustments also appear on the café&apos;s own dashboard, with the reason
          given. That is the layer that keeps us honest; this one is for us.
        </span>
      </p>

      {(searchParams.merchantId || searchParams.action) && (
        <p className="text-sm text-slate-700 mb-3">
          Filtered.{" "}
          <Link href="/admin/audit" className="underline">
            Show everything
          </Link>
        </p>
      )}

      {log.entries.length === 0 ? (
        <p className="text-sm text-slate-600">
          Nothing recorded yet — no changes have been made from this dashboard.
        </p>
      ) : (
        <>
          {log.truncated && (
            <p className="text-xs text-slate-500 mb-2">
              Showing the most recent 100. Filter by café to see further back.
            </p>
          )}
          <ul className="space-y-2">
            {log.entries.map((e) => (
              <li key={e.id} className="rounded-xl bg-white border border-slate-200 px-4 py-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-sm font-medium text-slate-900">
                    {ACTION_LABEL[e.action] ?? e.action}
                  </span>
                  {e.merchantId ? (
                    <Link
                      href={`/admin/merchants/${e.merchantId}`}
                      className="text-sm text-slate-600 hover:underline"
                    >
                      {/* Null name means the café has since been deleted —
                          precisely the case you most want the record of. */}
                      {e.merchantName ?? `${e.merchantId} (deleted)`}
                    </Link>
                  ) : null}
                  {e.targetType === "card" && e.targetId ? (
                    <Link
                      href={`/admin/cards/${e.targetId}`}
                      className="text-[11px] text-slate-500 hover:underline"
                    >
                      the card ↗
                    </Link>
                  ) : null}
                  <span className="ml-auto text-[11px] text-slate-500 tabular-nums whitespace-nowrap">
                    {e.actorEmail} · {e.createdAt.slice(0, 16).replace("T", " ")}
                  </span>
                </div>
                <p className="text-xs text-slate-700 mt-1">“{e.reason}”</p>
                <Diff before={e.before} after={e.after} />
              </li>
            ))}
          </ul>
        </>
      )}
    </AdminShell>
  );
}
