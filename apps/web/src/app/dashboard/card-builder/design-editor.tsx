"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { TemplateGallery } from "./template-gallery";
import {
  DEFAULT_CARD_DESIGN,
  STAMP_ICON_IDS,
  STAMP_ICON_LABELS,
  renderStampIcon,
  type BadgeStyle,
  type CardDesign,
  type StampIconId,
} from "@onusclub/shared";
import { CardPreview } from "../card-preview";

interface Props {
  programId: string;
  programName: string;
  businessName: string;
  rewardText: string;
  programType: "stamp" | "points";
  target: number;
  initialDesign: Partial<CardDesign>;
  brandColor?: string | null;
}

const BADGE_STYLES: { id: BadgeStyle; label: string }[] = [
  { id: "filled", label: "Filled" },
  { id: "outline", label: "Outline" },
  { id: "bare", label: "Icon only" },
];

export function DesignEditor({
  programId,
  programName,
  businessName,
  rewardText,
  programType,
  target,
  initialDesign,
  brandColor,
}: Props): JSX.Element {
  const router = useRouter();
  // The editor works on a full design object so every control is always
  // populated; only the merchant's own values get PATCHed back.
  const base: CardDesign = {
    ...DEFAULT_CARD_DESIGN,
    ...(brandColor ? { backgroundColor: brandColor } : {}),
    ...initialDesign,
  };
  const [design, setDesign] = useState<CardDesign>(base);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function set<K extends keyof CardDesign>(key: K, value: CardDesign[K]): void {
    setDesign((d) => ({ ...d, [key]: value }));
    setSaved(false);
  }

  async function save(): Promise<void> {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/programs/${programId}/design`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(design),
    });
    setSaving(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "could not save design");
      return;
    }
    setSaved(true);
    router.refresh();
  }

  const sample = Math.max(1, Math.floor(target / 2));
  const isStamp = programType === "stamp";

  return (
    <div className="space-y-5">
      {/* Above the controls: choosing a starting point is the right first
          question for someone who runs a barber shop, not "what hex value
          should your foreground be". */}
      <TemplateGallery
        current={design}
        businessName={businessName}
        programType={programType}
        target={target}
        onApply={(next) => {
          setDesign(next);
          setSaved(false);
        }}
      />

    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      {/* Live preview */}
      <div className="lg:sticky lg:top-4">
        <CardPreview
          businessName={businessName}
          programName={programName}
          rewardText={rewardText}
          current={sample}
          target={target}
          programType={programType}
          design={design}
        />
        <p className="mt-2 text-center text-xs text-brand-olive/70">
          Live preview · {sample}/{target}
        </p>
      </div>

      {/* Controls */}
      <div className="min-w-0 flex-1 space-y-5">
        {isStamp ? (
          <div>
            <label className="block text-xs font-medium uppercase tracking-wider text-brand-olive">
              Stamp icon
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              {STAMP_ICON_IDS.map((id: StampIconId) => {
                const active = design.stampIcon === id;
                return (
                  <button
                    key={id}
                    type="button"
                    title={STAMP_ICON_LABELS[id]}
                    aria-label={STAMP_ICON_LABELS[id]}
                    aria-pressed={active}
                    onClick={() => set("stampIcon", id)}
                    className={
                      "flex h-11 w-11 items-center justify-center rounded-lg border transition-colors " +
                      (active
                        ? "border-brand-green bg-brand-green/10"
                        : "border-brand-green/15 hover:border-brand-green/40")
                    }
                    dangerouslySetInnerHTML={{
                      __html: renderStampIcon(id, active ? "#14271C" : "#6B7A62", 22),
                    }}
                  />
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <ColorField
            label="Card background"
            value={design.backgroundColor}
            onChange={(v) => set("backgroundColor", v)}
          />
          <ColorField
            label={isStamp ? "Earned stamp" : "Progress bar"}
            value={design.stampFilledColor}
            onChange={(v) => set("stampFilledColor", v)}
          />
          <ColorField
            label="Badge / text"
            value={design.stampEmptyColor}
            onChange={(v) => set("stampEmptyColor", v)}
          />
        </div>

        {isStamp ? (
          <>
            <div>
              <label className="block text-xs font-medium uppercase tracking-wider text-brand-olive">
                Badge style
              </label>
              <div className="mt-2 inline-flex rounded-lg border border-brand-green/15 p-1">
                {BADGE_STYLES.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => set("badgeStyle", b.id)}
                    className={
                      "rounded-md px-3 py-1.5 text-sm transition-colors " +
                      (design.badgeStyle === b.id
                        ? "bg-brand-green text-white"
                        : "text-brand-olive hover:text-brand-green")
                    }
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="flex items-center gap-2 text-sm text-brand-green">
                <input
                  type="checkbox"
                  checked={design.pattern === "icon-tile"}
                  onChange={(e) =>
                    set("pattern", e.target.checked ? "icon-tile" : null)
                  }
                  className="h-4 w-4 rounded border-brand-green/30"
                />
                Tiled background pattern
              </label>
              {design.pattern === "icon-tile" ? (
                <div className="mt-2 flex items-center gap-3">
                  <input
                    type="range"
                    min={0.04}
                    max={0.4}
                    step={0.02}
                    value={design.patternOpacity}
                    onChange={(e) =>
                      set("patternOpacity", Number(e.target.value))
                    }
                    className="w-48"
                  />
                  <span className="text-xs tabular-nums text-brand-olive">
                    {Math.round(design.patternOpacity * 100)}%
                  </span>
                </div>
              ) : null}
            </div>
          </>
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            label="Progress label"
            value={design.progressLabel}
            onChange={(v) => set("progressLabel", v)}
          />
          <TextField
            label="Reward label"
            value={design.rewardsLabel}
            onChange={(v) => set("rewardsLabel", v)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-brand-green/10 pt-4">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="rounded-full bg-brand-green px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-green-deep disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save design"}
          </button>
          <button
            type="button"
            onClick={() => {
              setDesign({
                ...DEFAULT_CARD_DESIGN,
                ...(brandColor ? { backgroundColor: brandColor } : {}),
              });
              setSaved(false);
            }}
            className="text-sm text-brand-olive underline-offset-4 hover:text-brand-green hover:underline"
          >
            Reset to defaults
          </button>
          {saved ? (
            <span className="text-sm text-emerald-700">
              Saved — customer cards updated.
            </span>
          ) : null}
        </div>

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </div>
        ) : null}
      </div>
    </div>
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}): JSX.Element {
  return (
    <div>
      <label className="block text-xs font-medium uppercase tracking-wider text-brand-olive">
        {label}
      </label>
      <div className="mt-2 flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-10 cursor-pointer rounded border border-brand-green/15 bg-white p-0.5"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          className="w-24 rounded-md border border-brand-green/15 px-2 py-1.5 text-sm uppercase tabular-nums"
        />
      </div>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}): JSX.Element {
  return (
    <div>
      <label className="block text-xs font-medium uppercase tracking-wider text-brand-olive">
        {label}
      </label>
      <input
        type="text"
        value={value}
        maxLength={40}
        onChange={(e) => onChange(e.target.value)}
        className="mt-2 block w-full rounded-md border border-brand-green/15 px-3 py-2 text-sm"
      />
    </div>
  );
}
