import Link from "next/link";
import { notFound } from "next/navigation";
import type { MessageDelivery, SweepRun } from "@stampdeck/shared";
import { ApiCallError, apiFetch } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { DashboardShell } from "../../../dashboard-shell";
import { DeliveryTable } from "../../delivery-table";
import { RetryButton } from "../../retry-button";

export const dynamic = "force-dynamic";

export default async function SweepDetailPage({
  params,
}: {
  params: { id: string };
}): Promise<JSX.Element> {
  const { jwt, user, merchant } = await requireSession();

  let data: { sweep: SweepRun; deliveries: MessageDelivery[] };
  try {
    data = await apiFetch(`/v1/sweeps/${params.id}`, { jwt });
  } catch (err) {
    if (err instanceof ApiCallError && err.status === 404) notFound();
    throw err;
  }
  const { sweep, deliveries } = data;
  const failedForThisMerchant = deliveries.filter((d) => d.status === "failed").length;

  return (
    <DashboardShell user={user} merchant={merchant}>
      <div className="space-y-6">
        <Link href="/dashboard/messages" className="text-sm text-gray-600 underline">
          ← Back to Messages
        </Link>

        <header className="rounded-lg border border-gray-200 bg-white p-6">
          <p className="text-xs uppercase tracking-wide text-gray-500">
            {sweep.sweepType === "birthday" ? "Birthday sweep" : "Inactivity sweep"}
          </p>
          <h2 className="text-xl font-semibold text-gray-900 mt-1">
            {sweep.sweepType === "birthday"
              ? "Daily birthday greetings"
              : "30-day inactivity nudges"}
          </h2>
          <div className="mt-4 grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-500">Status</p>
              <p className="text-gray-900 mt-1">{sweep.status}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-500">
                Your customers reached
              </p>
              <p className="text-gray-900 mt-1 tabular-nums">{deliveries.length}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-500">Failed</p>
              <p className="text-gray-900 mt-1 tabular-nums">{failedForThisMerchant}</p>
            </div>
          </div>
          {sweep.errorMessage ? (
            <div className="mt-3 text-xs text-red-700">{sweep.errorMessage}</div>
          ) : null}
          {failedForThisMerchant > 0 ? (
            <div className="mt-4">
              <RetryButton retryPath={`/api/sweeps/${sweep.id}/retry`} />
            </div>
          ) : null}
        </header>

        <DeliveryTable deliveries={deliveries} />
      </div>
    </DashboardShell>
  );
}
