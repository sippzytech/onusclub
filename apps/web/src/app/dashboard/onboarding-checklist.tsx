import Link from "next/link";

/**
 * First-run checklist.
 *
 * Signup used to drop an owner on a dashboard of four dashed-out stat cards
 * and an empty activity feed, with the one thing they should do ("No programs
 * yet") pushed below all of it. This puts the next action first and removes
 * itself once there is nothing left to do.
 *
 * ⚠️ EVERY STEP IS DERIVED FROM REAL STATE, never from a stored "completed"
 * flag. That is the whole design:
 *
 *  - no migration, and no new column to keep in sync
 *  - it cannot desync — a café that deletes its only program sees step 1
 *    again, which is correct
 *  - "did they share the QR" is unanswerable, so the step asks the question
 *    that actually matters instead: did anyone join? A flag set by clicking a
 *    Share button would say someone clicked a button.
 *
 * There is deliberately no dismiss button. It would need somewhere to store
 * the dismissal, and a four-item list that disappears on its own when complete
 * does not need an escape hatch — whereas a dismissed checklist is gone for
 * good at precisely the moment the café most needs it.
 */
export interface OnboardingState {
  hasProgram: boolean;
  hasBranding: boolean;
  hasCustomer: boolean;
  hasScan: boolean;
  publicSlug: string;
  webBase: string;
}

interface Step {
  done: boolean;
  title: string;
  /** What this gets them. Not a restatement of the title. */
  why: string;
  href: string;
  cta: string;
}

function buildSteps(s: OnboardingState): Step[] {
  return [
    {
      done: s.hasProgram,
      title: "Create your loyalty card",
      why: "How many stamps, and what the reward is. Two minutes.",
      href: "/dashboard/card-builder",
      cta: "Card builder",
    },
    {
      done: s.hasBranding,
      title: "Add your logo and colour",
      why: "Until you do, your customers' passes show the OnUsClub badge instead of yours.",
      href: "/dashboard/settings",
      cta: "Settings",
    },
    {
      done: s.hasCustomer,
      title: "Get your first member",
      why: s.publicSlug
        ? "Put your signup QR on the counter, or add someone by hand."
        : "Add someone by hand, or share your signup link.",
      href: "/dashboard/customers",
      cta: "Customers",
    },
    {
      done: s.hasScan,
      title: "Scan a card",
      why: "Stamp your own card once to see the whole loop — the pass on the phone updates instantly.",
      href: "/dashboard/scan",
      cta: "Open scanner",
    },
  ];
}

function Tick({ done }: { done: boolean }): JSX.Element {
  return done ? (
    <span
      aria-hidden="true"
      className="mt-0.5 h-5 w-5 shrink-0 rounded-full bg-brand-green text-white flex items-center justify-center text-xs"
    >
      ✓
    </span>
  ) : (
    <span
      aria-hidden="true"
      className="mt-0.5 h-5 w-5 shrink-0 rounded-full border border-brand-green/25"
    />
  );
}

export function OnboardingChecklist({
  state,
}: {
  state: OnboardingState;
}): JSX.Element | null {
  const steps = buildSteps(state);
  const done = steps.filter((s) => s.done).length;

  // Nothing left to do — and nothing left to show. The component removing
  // itself is why it needs no dismiss control.
  if (done === steps.length) return null;

  // The first unfinished step, which is the only one that gets a button. Four
  // competing calls to action is the same as none.
  const next = steps.find((s) => !s.done);

  return (
    <section className="rounded-card bg-white border border-brand-green/15 p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-serif text-2xl text-brand-green">
          {done === 0 ? "Let's get you set up" : "Nearly there"}
        </h2>
        <p className="text-xs text-brand-olive tabular-nums">
          {done} of {steps.length} done
        </p>
      </div>

      {/* Progress as a bar rather than a percentage: four steps is a shape, not
          a statistic. */}
      <div className="h-1.5 rounded-full bg-brand-green/10 mt-3 overflow-hidden">
        <div
          className="h-full rounded-full bg-brand-green transition-all"
          style={{ width: `${(done / steps.length) * 100}%` }}
        />
      </div>

      <ol className="mt-5 space-y-3">
        {steps.map((step) => {
          const isNext = step === next;
          return (
            <li key={step.title} className="flex gap-3">
              <Tick done={step.done} />
              <div className="min-w-0 flex-1">
                <p
                  className={
                    step.done
                      ? "text-sm text-brand-olive line-through decoration-brand-olive/40"
                      : isNext
                        ? "text-sm font-medium text-brand-green"
                        : "text-sm text-brand-green"
                  }
                >
                  {step.title}
                </p>
                {!step.done && (
                  <p className="text-xs text-brand-olive mt-0.5">{step.why}</p>
                )}
              </div>
              {isNext && (
                <Link
                  href={step.href}
                  className="shrink-0 self-start rounded-full bg-brand-green text-brand-cream text-sm px-4 py-2 hover:bg-brand-green-deep transition-colors"
                >
                  {step.cta}
                </Link>
              )}
            </li>
          );
        })}
      </ol>

      {/* The signup link is the single most useful string on this page for a
          café that has a card but no members, so it is given verbatim rather
          than hidden behind another click. */}
      {state.hasProgram && !state.hasCustomer && state.publicSlug && (
        <div className="mt-5 pt-4 border-t border-brand-green/10">
          <p className="text-xs text-brand-olive">
            Your signup page — print the QR from{" "}
            <Link href="/dashboard/customers" className="underline">
              Customers
            </Link>
            , or send this link:
          </p>
          <p className="text-sm text-brand-green font-mono break-all mt-1">
            {state.webBase}/m/{state.publicSlug}
          </p>
        </div>
      )}
    </section>
  );
}
