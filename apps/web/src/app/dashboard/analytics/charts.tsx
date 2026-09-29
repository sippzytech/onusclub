// Inline SVG charts for the analytics page.
//
// Hand-rolled rather than pulling in a charting library, for the same reason
// packages/shared/src/card-art.ts is: these are pure functions of their props
// with no DOM and no interactivity, so they render on the server and ship zero
// client JavaScript. A library would turn every chart into a client component
// and add bundle weight for shapes this simple.
//
// All of them are plain server components — no "use client" anywhere in here.

import { centsToEuroString } from "@onusclub/shared";

const GREEN = "#14271C";
const GOLD = "#B0894F";
const OLIVE = "#6e7860";

/** Path for a polyline through the points, plus a closed area beneath it. */
function buildPaths(
  values: number[],
  width: number,
  height: number,
  pad: number
): { line: string; area: string } {
  const max = Math.max(...values, 1);
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  // A single point has no span to divide by; centre it rather than dividing by 0.
  const step = values.length > 1 ? innerW / (values.length - 1) : 0;

  const pts = values.map((v, i) => {
    const x = values.length > 1 ? pad + i * step : width / 2;
    const y = pad + innerH - (v / max) * innerH;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  const line = `M${pts.join(" L")}`;
  const firstX = values.length > 1 ? pad : width / 2;
  const lastX = values.length > 1 ? pad + (values.length - 1) * step : width / 2;
  const base = pad + innerH;
  const area = `${line} L${lastX.toFixed(2)},${base} L${firstX.toFixed(2)},${base} Z`;
  return { line, area };
}

interface TrendChartProps {
  title: string;
  series: Array<{ date: string; value: number }>;
  /** Formats the peak label and the accessible summary. */
  format: (value: number) => string;
  accent?: string;
}

/**
 * Area + line trend. Deliberately one metric per chart: putting visits and
 * revenue on a shared axis would need a second y-scale, and dual-axis charts
 * invite readers to see correlations that the scaling invented.
 */
export function TrendChart({
  title,
  series,
  format,
  accent = GREEN,
}: TrendChartProps): JSX.Element {
  const W = 640;
  const H = 180;
  const PAD = 16;
  const values = series.map((s) => s.value);
  const max = Math.max(...values, 0);
  const { line, area } = buildPaths(values, W, H, PAD);
  const gradientId = `grad-${title.replace(/\W/g, "")}`;

  // Three x labels only. With a 12-month range there are 365 points and any
  // per-point label would be unreadable mush.
  const labels = [series[0], series[Math.floor(series.length / 2)], series[series.length - 1]]
    .filter(Boolean)
    .map((s) => s.date.slice(5));

  return (
    <figure className="rounded-card bg-white border border-brand-green/10 p-5">
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-brand-olive">{title}</span>
        <span className="font-serif text-2xl text-brand-green tabular-nums">
          {format(values.reduce((a, b) => a + b, 0))}
        </span>
      </figcaption>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height="auto"
        className="mt-4 overflow-visible"
        role="img"
        aria-label={`${title}: peak ${format(max)} in a single day`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity="0.18" />
            <stop offset="100%" stopColor={accent} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Baseline so an all-zero series still reads as a chart, not a blank box. */}
        <line
          x1={PAD}
          y1={H - PAD}
          x2={W - PAD}
          y2={H - PAD}
          stroke={OLIVE}
          strokeOpacity="0.25"
          vectorEffect="non-scaling-stroke"
        />
        {max > 0 ? (
          <>
            <path d={area} fill={`url(#${gradientId})`} />
            <path
              d={line}
              fill="none"
              stroke={accent}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </>
        ) : null}
      </svg>

      <div className="flex justify-between mt-2 text-[11px] text-brand-olive tabular-nums">
        {labels.map((l, i) => (
          <span key={`${l}-${i}`}>{l}</span>
        ))}
      </div>
    </figure>
  );
}

interface HourBarsProps {
  hours: Array<{ hour: number; visits: number }>;
  timezone: string;
}

/**
 * Busiest-hours histogram. The hours are already merchant-local by the time
 * they reach here — see the timezone note in routes/analytics.ts — and the
 * timezone is printed so nobody reads the chart in their own.
 */
export function HourBars({ hours, timezone }: HourBarsProps): JSX.Element {
  const max = Math.max(...hours.map((h) => h.visits), 0);
  const peak = max > 0 ? hours.find((h) => h.visits === max) : undefined;

  return (
    <figure className="rounded-card bg-white border border-brand-green/10 p-5">
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-brand-olive">Busiest hours</span>
        <span className="text-xs text-brand-olive">{timezone}</span>
      </figcaption>

      {max === 0 ? (
        <p className="text-sm text-brand-olive mt-6 mb-2">No visits in this period yet.</p>
      ) : (
        <>
          <p className="font-serif text-2xl text-brand-green mt-1 tabular-nums">
            {String(peak?.hour ?? 0).padStart(2, "0")}:00
            <span className="text-sm font-sans text-brand-olive ml-2">busiest</span>
          </p>
          <div className="flex items-end gap-[3px] h-28 mt-4" role="img"
               aria-label={`Busiest hour is ${peak?.hour}:00 with ${max} visits`}>
            {hours.map((h) => (
              <div
                key={h.hour}
                className="flex-1 rounded-t-sm"
                style={{
                  // Minimum 2px so a quiet-but-nonzero hour stays visible.
                  height: h.visits === 0 ? "2px" : `${Math.max(4, (h.visits / max) * 100)}%`,
                  backgroundColor: h.visits === max ? GOLD : GREEN,
                  opacity: h.visits === 0 ? 0.15 : h.visits === max ? 1 : 0.55,
                }}
                title={`${String(h.hour).padStart(2, "0")}:00 — ${h.visits} visit${h.visits === 1 ? "" : "s"}`}
              />
            ))}
          </div>
          <div className="flex justify-between mt-2 text-[11px] text-brand-olive tabular-nums">
            <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
          </div>
        </>
      )}
    </figure>
  );
}

interface SplitBarProps {
  newCards: number;
  returningCards: number;
}

/** New vs returning, as a single proportional bar — two numbers don't need a pie. */
export function NewVsReturning({ newCards, returningCards }: SplitBarProps): JSX.Element {
  const total = newCards + returningCards;
  const returningPct = total > 0 ? (returningCards / total) * 100 : 0;

  return (
    <figure className="rounded-card bg-white border border-brand-green/10 p-5">
      <figcaption className="text-sm text-brand-olive">New vs returning</figcaption>
      {total === 0 ? (
        <p className="text-sm text-brand-olive mt-6">No visitors in this period yet.</p>
      ) : (
        <>
          <p className="font-serif text-3xl text-brand-green mt-3 tabular-nums">
            {Math.round(returningPct)}%
            <span className="text-sm font-sans text-brand-olive ml-2">returning</span>
          </p>
          <div className="flex h-3 rounded-full overflow-hidden mt-4 bg-brand-cream">
            <div style={{ width: `${returningPct}%`, backgroundColor: GREEN }} />
            <div style={{ width: `${100 - returningPct}%`, backgroundColor: GOLD }} />
          </div>
          <div className="flex justify-between mt-3 text-xs text-brand-olive">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: GREEN }} />
              {returningCards} returning
            </span>
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: GOLD }} />
              {newCards} new
            </span>
          </div>
        </>
      )}
    </figure>
  );
}

interface TopListProps {
  title: string;
  members: Array<{ cardId: string; customerName: string | null; visits: number; revenueCents: number }>;
  metric: "visits" | "revenue";
  currencyCode: string;
}

export function TopList({ title, members, metric, currencyCode }: TopListProps): JSX.Element {
  return (
    <div className="rounded-card bg-white border border-brand-green/10 p-5">
      <p className="text-sm text-brand-olive">{title}</p>
      {members.length === 0 ? (
        <p className="text-sm text-brand-olive mt-4">Nothing to rank yet.</p>
      ) : (
        <ol className="mt-4 space-y-3">
          {members.map((m, i) => (
            <li key={m.cardId} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-3 min-w-0">
                <span className="text-brand-olive tabular-nums w-4">{i + 1}</span>
                <span className="text-brand-green truncate">
                  {m.customerName ?? "Unnamed member"}
                </span>
              </span>
              <span className="text-brand-green tabular-nums shrink-0">
                {metric === "visits"
                  ? `${m.visits} visit${m.visits === 1 ? "" : "s"}`
                  : centsToEuroString(m.revenueCents, currencyCode)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
