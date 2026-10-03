import { centsToEuroString, type RfmOverview, type RfmSegment } from "@onusclub/shared";

// What each bucket means and, more usefully, what to do about it. A segment
// chart that does not tell a café owner what action it implies is decoration.
const COPY: Record<RfmSegment, { label: string; action: string; tone: string }> = {
  champions: {
    label: "Champions",
    action: "Your best customers. Worth asking for a Google review.",
    tone: "text-emerald-800 bg-emerald-50 border-emerald-200",
  },
  promising: {
    label: "Promising",
    action: "Coming back, not yet regulars. A nudge turns these into champions.",
    tone: "text-brand-green bg-brand-cream border-brand-green/15",
  },
  new: {
    label: "New",
    action: "One visit so far. The second visit is where loyalty sticks.",
    tone: "text-brand-green bg-brand-cream border-brand-green/15",
  },
  at_risk: {
    label: "At risk",
    action: "Used to come often, gone quiet. This is where a win-back pays.",
    tone: "text-amber-900 bg-amber-50 border-amber-200",
  },
  sleeping: {
    label: "Sleeping",
    action: "Occasional visitors who have drifted. Cheap to try, low expectation.",
    tone: "text-brand-olive bg-white border-brand-green/10",
  },
  lost: {
    label: "Lost",
    action: "Long gone. Usually better to spend the effort on the groups above.",
    tone: "text-brand-olive bg-white border-brand-green/10",
  },
};

export function Segments({ data }: { data: RfmOverview }): JSX.Element {
  const max = Math.max(...data.segments.map((s) => s.customers), 1);

  return (
    <section className="rounded-card bg-white border border-brand-green/10 p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-serif text-2xl text-brand-green">Customer segments</h2>
        <p className="text-xs text-brand-olive">
          {data.totalClassified} customer{data.totalClassified === 1 ? "" : "s"} with at least one
          visit
        </p>
      </div>

      {/* State the rule rather than presenting the buckets as self-evident. */}
      <p className="text-xs text-brand-olive mt-2">
        Based on when someone last visited and how often. &ldquo;Recent&rdquo; means the last{" "}
        {data.thresholds.recentDays} days, &ldquo;regular&rdquo; means {data.thresholds.frequentVisits}+
        visits, and after {data.thresholds.lapsedDays} days we count someone as lost.
      </p>

      {data.totalClassified === 0 ? (
        <p className="text-sm text-brand-olive mt-6">
          Nobody has visited yet — segments appear once customers start scanning.
        </p>
      ) : (
        <ul className="mt-5 space-y-3">
          {data.segments.map((s) => {
            const copy = COPY[s.segment];
            const pct = (s.customers / max) * 100;
            return (
              <li key={s.segment} className={`rounded-lg border px-4 py-3 ${copy.tone}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{copy.label}</span>
                  <span className="tabular-nums text-sm">
                    {s.customers} customer{s.customers === 1 ? "" : "s"}
                    {s.revenueCents > 0 && (
                      <span className="opacity-70">
                        {" · "}
                        {centsToEuroString(s.revenueCents, data.currencyCode)}
                      </span>
                    )}
                  </span>
                </div>
                {/* Bar is relative to the biggest segment, so the shape of the
                    customer base reads at a glance without an axis. */}
                <div className="h-1.5 rounded-full bg-black/5 mt-2 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-current opacity-40"
                    style={{ width: `${Math.max(s.customers > 0 ? 4 : 0, pct)}%` }}
                  />
                </div>
                <p className="text-xs mt-2 opacity-80">{copy.action}</p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
