import type { MessageDelivery } from "@onusclub/shared";

function statusBadge(status: MessageDelivery["status"]): JSX.Element {
  if (status === "sent") {
    return (
      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
        ✓ sent
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800">
        ✗ failed
      </span>
    );
  }
  return (
    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
      pending
    </span>
  );
}

export function DeliveryTable({
  deliveries,
}: {
  deliveries: MessageDelivery[];
}): JSX.Element {
  if (deliveries.length === 0) {
    return (
      <div className="rounded-md border border-gray-200 bg-white p-4 text-sm text-gray-600">
        No deliveries recorded.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-gray-50">
          <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
            <th className="px-4 py-2">Customer</th>
            <th className="px-4 py-2">Program</th>
            <th className="px-4 py-2">Status</th>
            <th className="px-4 py-2 tabular-nums">Attempts</th>
            <th className="px-4 py-2">Last error</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {deliveries.map((d) => (
            <tr key={d.id}>
              <td className="px-4 py-2 text-gray-900">
                {d.customerName ?? "(no name)"}
              </td>
              <td className="px-4 py-2 text-gray-700">{d.programName}</td>
              <td className="px-4 py-2">{statusBadge(d.status)}</td>
              <td className="px-4 py-2 tabular-nums">{d.attempts}</td>
              <td className="px-4 py-2 text-gray-700 max-w-md truncate">
                {d.lastError ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
