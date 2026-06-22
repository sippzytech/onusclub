import type { CardEvent } from "@onusclub/shared";

function describe(e: CardEvent): string {
  const d = e.deltaJson as Record<string, unknown> | null;
  switch (e.eventType) {
    case "signup":
      return "Card enrolled";
    case "stamp": {
      const before = (d?.stamps_before as number | undefined) ?? "?";
      const after = (d?.stamps_after as number | undefined) ?? "?";
      const req = (d?.stamps_required as number | undefined) ?? "?";
      return `Stamp added (${before} → ${after} / ${req})`;
    }
    case "redeem": {
      const before = (d?.rewards_redeemed_before as number | undefined) ?? "?";
      const after = (d?.rewards_redeemed_after as number | undefined) ?? "?";
      return `Reward redeemed (total redemptions ${before} → ${after})`;
    }
    case "reset":
      return "Stamps reset";
    case "manual_adjust":
      return "Manual adjustment";
    default:
      return e.eventType;
  }
}

export function EventTimeline({ events }: { events: CardEvent[] }): JSX.Element {
  if (events.length === 0) {
    return <p className="text-sm text-gray-600">No activity yet.</p>;
  }
  return (
    <ol className="space-y-2">
      {events.map((e) => (
        <li
          key={e.id}
          className="rounded-md border border-gray-200 bg-white p-3 text-sm flex items-center justify-between"
        >
          <span className="text-gray-900">{describe(e)}</span>
          <span className="text-xs text-gray-500 tabular-nums">
            {new Date(e.createdAt).toLocaleString()}
          </span>
        </li>
      ))}
    </ol>
  );
}
