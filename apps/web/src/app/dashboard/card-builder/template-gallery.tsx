"use client";

import { useState } from "react";
import {
  CARD_TEMPLATES,
  TEMPLATE_INDUSTRIES,
  applyTemplate,
  type CardDesign,
  type CardTemplate,
  type TemplateIndustry,
} from "@onusclub/shared";
import { CardPreview } from "../card-preview";

/**
 * Pick a starting point instead of a hex code.
 *
 * The editor already lets a café choose every colour individually, which is
 * the wrong first question to ask someone who runs a barber shop. A gallery
 * turns "what should my foreground colour be" into "which of these looks like
 * my place", and the editor stays open underneath for anyone who wants to
 * change it afterwards.
 *
 * ⚠️ Applying a template only changes LOCAL EDITOR STATE. Nothing is written
 * until the merchant hits Save in the editor below, exactly as if they had
 * moved the controls by hand. A gallery that silently persisted on click would
 * mean browsing the options rewrote a live card several times.
 */
export function TemplateGallery({
  current,
  onApply,
  programType,
  target,
  businessName,
}: {
  current: CardDesign;
  onApply: (design: CardDesign) => void;
  programType: "stamp" | "points";
  target: number;
  businessName: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [industry, setIndustry] = useState<TemplateIndustry>(TEMPLATE_INDUSTRIES[0]);
  const [appliedId, setAppliedId] = useState<string | null>(null);

  const shown = CARD_TEMPLATES.filter((t) => t.industry === industry);

  function apply(template: CardTemplate): void {
    // Labels are carried over, not reset — restyling is not relabelling. A
    // café that renamed "STAMPS UNTIL THE REWARD" into Dutch should not lose
    // that by trying a different colour scheme.
    onApply(applyTemplate(template, current));
    setAppliedId(template.id);
  }

  return (
    <section className="rounded-card border border-brand-green/15 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="font-serif text-xl text-brand-green">Start from a template</h3>
          <p className="text-xs text-brand-olive mt-0.5">
            A starting point you can change. Nothing is saved until you press Save below.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="rounded-full border border-brand-green/20 px-4 py-2 text-sm text-brand-green hover:border-brand-green/50 transition-colors"
        >
          {open ? "Hide templates" : `Browse ${CARD_TEMPLATES.length} templates`}
        </button>
      </div>

      {open && (
        <>
          <div className="mt-4 flex flex-wrap gap-2">
            {TEMPLATE_INDUSTRIES.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setIndustry(name)}
                className={
                  "rounded-full px-3 py-1.5 text-xs transition-colors " +
                  (name === industry
                    ? "bg-brand-green text-brand-cream"
                    : "border border-brand-green/20 text-brand-olive hover:border-brand-green/50")
                }
              >
                {name}
              </button>
            ))}
          </div>

          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {shown.map((template) => {
              const tileTarget = programType === "stamp" ? Math.min(target || 6, 10) : 6;
              return (
                <li key={template.id}>
                  <button
                    type="button"
                    onClick={() => apply(template)}
                    className={
                      "block w-full overflow-hidden rounded-lg border text-left transition-colors " +
                      (appliedId === template.id
                        ? "border-brand-green ring-2 ring-brand-green/30"
                        : "border-brand-green/15 hover:border-brand-green/50")
                    }
                  >
                    {/* The tile IS the real card component, shrunk. A swatch
                        of three colours would not show the badge style or the
                        pattern, which are half of what distinguishes these —
                        and a bespoke tile renderer could promise something the
                        actual pass does not show. */}
                    <span className="block pointer-events-none">
                      <CardPreview
                        businessName={businessName}
                        programName=""
                        rewardText=""
                        current={Math.max(1, Math.floor(tileTarget / 2))}
                        target={tileTarget}
                        programType="stamp"
                        design={applyTemplate(template, current)}
                        size="compact"
                      />
                    </span>
                    <span className="block px-3 py-2">
                      <span className="block text-sm text-brand-green">{template.name}</span>
                      <span className="block text-[11px] text-brand-olive leading-snug">
                        {template.blurb}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {appliedId && (
            <p className="mt-4 rounded-lg border border-brand-gold/40 bg-brand-gold/10 px-4 py-3 text-sm text-brand-green">
              Applied to the preview. Adjust anything you like below, then press{" "}
              <strong>Save design</strong> — until you do, nothing has changed for your
              customers.
            </p>
          )}
        </>
      )}
    </section>
  );
}
