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
    case "points_add": {
      const amount = d?.amount_euros as number | undefined;
      const earned = d?.points_earned as number | undefined;
      const before = d?.balance_before as number | undefined;
      const after = d?.balance_after as number | undefined;
      const reward = d?.points_for_reward as number | undefined;
      const parts: string[] = [];
      if (amount !== undefined && earned !== undefined) {
        parts.push(`+${earned} points from €${amount}`);
      } else if (earned !== undefined) {
        parts.push(`+${earned} points`);
      } else {
        parts.push("Points added");
      }
      if (before !== undefined && after !== undefined) {
        parts.push(`${before} → ${after}${reward ? ` / ${reward}` : ""}`);
      }
      return parts.join(" · ");
    }
    case "redeem": {
      // Points redeems carry balance_before/after; stamps redeems don't.
      const balBefore = d?.balance_before as number | undefined;
      const balAfter = d?.balance_after as number | undefined;
      const rewardsBefore = d?.rewards_redeemed_before as number | undefined;
      const rewardsAfter = d?.rewards_redeemed_after as number | undefined;
      if (balBefore !== undefined && balAfter !== undefined) {
        return `Reward redeemed (${balBefore} → ${balAfter} points · total ${rewardsAfter ?? "?"})`;
      }
      return `Reward redeemed (total redemptions ${rewardsBefore ?? "?"} → ${rewardsAfter ?? "?"})`;
    }
    case "expire": {
      // Two flavors: card-level inactivity expiry, or points-batch expiry.
      const via = d?.via as string | undefined;
      if (via === "points_expiry_sweep") {
        const lost = d?.points_expired as number | undefined;
        const before = d?.balance_before as number | undefined;
        const after = d?.balance_after as number | undefined;
        return `${lost ?? "?"} points expired (${before ?? "?"} → ${after ?? "?"})`;
      }
      const days = d?.days as number | undefined;
      return days
        ? `Card expired after ${days} days of inactivity`
        : "Card expired";
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
    return <p className="text-sm text-brand-olive">No activity yet.</p>;
  }
  return (
    <ol className="space-y-2">
      {events.map((e) => (
        <li
          key={e.id}
          className="rounded-lg border border-brand-green/10 bg-brand-cream/40 p-3 text-sm flex items-center justify-between gap-3"
        >
          <span className="text-brand-green">{describe(e)}</span>
          <span className="text-xs text-brand-olive tabular-nums shrink-0">
            {new Date(e.createdAt).toLocaleString()}
          </span>
        </li>
      ))}
    </ol>
  );
}
