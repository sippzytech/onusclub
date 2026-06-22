import Link from "next/link";
import { notFound } from "next/navigation";
import type { AudienceFilter, Broadcast, MessageDelivery } from "@onusclub/shared";
import { ApiCallError, apiFetch } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { DashboardShell } from "../../../dashboard-shell";
import { DeliveryTable } from "../../delivery-table";
import { RetryButton } from "../../retry-button";

export const dynamic = "force-dynamic";

function describeAudience(filter: AudienceFilter): string {
  const parts: string[] = [];
  if (filter.minLifetimeStamps !== undefined) {
    parts.push(`≥ ${filter.minLifetimeStamps} lifetime stamps`);
  }
  if (filter.withBirthdayThisMonth) {
    parts.push("birthday this month");
  }
  if (filter.programId) {
    parts.push("specific program");
  }
  return parts.length === 0
    ? "all active customers (no filters applied)"
    : "customers with " + parts.join(" AND ");
}

export default async function BroadcastDetailPage({
  params,
}: {
  params: { id: string };
}): Promise<JSX.Element> {
  const { jwt, user, merchant } = await requireSession();

  let data: { broadcast: Broadcast; deliveries: MessageDelivery[] };
  try {
    data = await apiFetch(`/v1/broadcasts/${params.id}`, { jwt });
  } catch (err) {
    if (err instanceof ApiCallError && err.status === 404) notFound();
    throw err;
  }
  const { broadcast, deliveries } = data;

  return (
    <DashboardShell user={user} merchant={merchant}>
      <div className="space-y-6">
        <Link href="/dashboard/messages" className="text-sm text-gray-600 underline">
          ← Back to Messages
        </Link>

        <header className="rounded-lg border border-gray-200 bg-white p-6">
          <p className="text-xs uppercase tracking-wide text-gray-500">Broadcast</p>
          <h2 className="text-xl font-semibold text-gray-900 mt-1">{broadcast.header}</h2>
          <p className="text-sm text-gray-700 mt-2 whitespace-pre-wrap">{broadcast.body}</p>
          {broadcast.audienceFilter ? (
            <p className="mt-3 text-xs text-gray-600">
              <span className="font-medium text-gray-700">Audience:</span>{" "}
              {describeAudience(broadcast.audienceFilter)}
            </p>
          ) : (
            <p className="mt-3 text-xs text-gray-600">
              <span className="font-medium text-gray-700">Audience:</span> all active
              customers
            </p>
          )}
          <div className="mt-4 grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-500">Status</p>
              <p className="text-gray-900 mt-1">{broadcast.status}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-500">Sent / Total</p>
              <p className="text-gray-900 mt-1 tabular-nums">
                {broadcast.sent} / {broadcast.scanned}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-500">Failed</p>
              <p className="text-gray-900 mt-1 tabular-nums">{broadcast.failed}</p>
            </div>
          </div>
          {broadcast.failed > 0 ? (
            <div className="mt-4">
              <RetryButton retryPath={`/api/broadcasts/${broadcast.id}/retry`} />
            </div>
          ) : null}
        </header>

        <DeliveryTable deliveries={deliveries} />
      </div>
    </DashboardShell>
  );
}
