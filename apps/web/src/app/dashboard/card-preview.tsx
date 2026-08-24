import {
  DEFAULT_CARD_DESIGN,
  renderStampGrid,
  sanitizeColor,
  type CardDesign,
  type StampIconId,
} from "@onusclub/shared";

/**
 * "How it looks on the customer's phone."
 *
 * Mirrors the wallet-pass anatomy documented in docs/card-design/README.md:
 * title bar → strip (stamp grid over a tiled motif) → field row → body fill →
 * barcode. Stamp programs get the badge grid; points programs get a progress
 * bar, because a grid of 420/1000 would be nonsense.
 *
 * Server component — the grid is a plain SVG string, no client JS involved.
 */

export interface CardPreviewProps {
  businessName: string;
  programName: string;
  rewardText: string;
  current: number;
  target: number;
  programType: "stamp" | "points";
  brandColor?: string | null;
  /** Pre-rendered QR SVG. Falls back to a placeholder block when omitted. */
  qrSvg?: string | null;
  /** Overrides on top of DEFAULT_CARD_DESIGN — the editor will drive these. */
  design?: Partial<CardDesign>;
  /** Shrink for use in a list of programs. */
  size?: "full" | "compact";
}

export function CardPreview({
  businessName,
  programName,
  rewardText,
  current,
  target,
  programType,
  brandColor,
  qrSvg,
  design,
  size = "full",
}: CardPreviewProps): JSX.Element {
  const d: CardDesign = {
    ...DEFAULT_CARD_DESIGN,
    ...(brandColor ? { backgroundColor: brandColor } : {}),
    ...design,
  };
  const bg = sanitizeColor(d.backgroundColor, DEFAULT_CARD_DESIGN.backgroundColor);
  const fg = sanitizeColor(d.foregroundColor, "#FFFFFF");

  const isStamp = programType === "stamp";
  const remaining = Math.max(0, target - current);

  const grid =
    isStamp && target > 0 && target <= 30
      ? renderStampGrid({
          current,
          total: target,
          icon: d.stampIcon as StampIconId,
          filledColor: d.stampFilledColor,
          emptyColor: d.stampEmptyColor,
          badgeStyle: d.badgeStyle,
          background: bg,
          pattern: d.pattern,
          patternColor: d.stampEmptyColor,
          patternOpacity: d.patternOpacity,
          radius: 0,
        })
      : null;

  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  const frameWidth = size === "compact" ? "w-[210px]" : "w-[280px]";

  return (
    <div className={`${frameWidth} shrink-0`}>
      {/* Phone frame */}
      <div className="rounded-[2rem] bg-neutral-900 p-2.5 shadow-lg ring-1 ring-black/10">
        <div className="relative overflow-hidden rounded-[1.6rem] bg-neutral-100">
          {/* notch */}
          <div className="absolute left-1/2 top-1.5 z-10 h-3.5 w-16 -translate-x-1/2 rounded-full bg-neutral-900" />

          <div className="px-2.5 pb-3 pt-7">
            {/* The pass itself */}
            <div
              className="overflow-hidden rounded-xl shadow-sm"
              style={{ backgroundColor: bg, color: fg }}
            >
              <div className="px-3 pb-2 pt-2.5">
                <p className="truncate text-[10px] font-medium opacity-90">
                  {businessName}
                </p>
              </div>

              {grid ? (
                <div
                  className="[&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
                  dangerouslySetInnerHTML={{ __html: grid.svg }}
                />
              ) : (
                <div className="px-3 py-4">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-white/25">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: sanitizeColor(d.stampFilledColor, "#C8A24A"),
                      }}
                    />
                  </div>
                  <p className="mt-2 text-center font-medium tabular-nums">
                    {current}
                    <span className="opacity-70">/{target}</span>{" "}
                    <span className="text-[10px] uppercase tracking-wide opacity-70">
                      points
                    </span>
                  </p>
                </div>
              )}

              {/* Field row — the two labels every wallet pass carries */}
              <div className="flex items-start justify-between gap-2 px-3 pb-3 pt-2">
                <div className="min-w-0">
                  <p className="text-[7px] uppercase tracking-wider opacity-70">
                    {d.progressLabel}
                  </p>
                  <p className="truncate text-[11px] font-medium">
                    {remaining > 0
                      ? `${remaining} ${isStamp ? "stamps" : "points"}`
                      : "Ready!"}
                  </p>
                </div>
                <div className="min-w-0 text-right">
                  <p className="text-[7px] uppercase tracking-wider opacity-70">
                    {d.rewardsLabel}
                  </p>
                  <p className="truncate text-[11px] font-medium">{rewardText}</p>
                </div>
              </div>

              {/* Barcode block */}
              <div className="px-3 pb-3">
                <div className="mx-auto flex h-[70px] w-[70px] items-center justify-center rounded-md bg-white p-1">
                  {qrSvg ? (
                    <div
                      className="[&>svg]:block [&>svg]:h-full [&>svg]:w-full"
                      dangerouslySetInnerHTML={{ __html: qrSvg }}
                    />
                  ) : (
                    <div className="h-full w-full rounded-sm bg-[repeating-linear-gradient(90deg,#111_0_2px,#fff_2px_4px)]" />
                  )}
                </div>
              </div>
            </div>

            <p className="mt-2 text-center text-[9px] text-neutral-400">
              {programName}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
