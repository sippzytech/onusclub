import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The frame around first-run setup: progress, one step, one way forward.
 *
 * Deliberately NOT `DashboardShell`. The whole point is that the nine-item
 * sidebar is not shown yet — an owner who has made no decisions does not
 * need Analytics, Campaigns and Team competing for attention with the one
 * thing he is meant to do. He gets them the moment setup is done, or the
 * moment he asks for them.
 *
 * ⚠️ The escape hatch at the bottom is not optional. Trapping someone in a
 * wizard is a worse confusion than the crowded dashboard this replaced, and
 * the Overview checklist covers anyone who leaves early.
 */

const STEP_TITLES = ["Your offer", "Your card", "Your first customer"] as const;

export function SetupShell({
  businessName,
  step,
  completed,
  total,
  done,
  allDone,
  children,
}: {
  businessName: string;
  step: number;
  completed: number;
  total: number;
  done: boolean[];
  allDone: boolean;
  children: ReactNode;
}): JSX.Element {
  const next = step + 1;
  const prev = step - 1;

  return (
    <div className="min-h-screen bg-brand-cream">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
        <header>
          <p className="text-xs uppercase tracking-wider text-brand-olive">
            {businessName}
          </p>
          {/* Plain apostrophes: these are JS strings, not JSX text, so an
              &apos; entity would be printed literally. */}
          <h1 className="font-serif text-3xl text-brand-green mt-1">
            {allDone ? "You’re all set" : "Let’s get you set up"}
          </h1>
          <p className="text-sm text-brand-olive mt-2">
            {allDone
              ? "Everything is ready. You can change any of it later."
              : "Three short steps. You can change everything later."}
          </p>
        </header>

        {/* Progress. Named steps rather than "2 of 3", so someone can see
            what is coming and what they already did. */}
        <ol className="mt-6 flex flex-wrap items-center gap-2 text-xs">
          {STEP_TITLES.map((title, i) => {
            const isCurrent = i === step;
            const isDone = done[i] === true;
            return (
              <li key={title}>
                <Link
                  href={`/dashboard/setup?step=${i}`}
                  className={[
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-colors",
                    isCurrent
                      ? "bg-brand-green text-brand-cream"
                      : isDone
                        ? "bg-brand-green/10 text-brand-green hover:bg-brand-green/20"
                        : "bg-white text-brand-olive border border-brand-green/15 hover:border-brand-green/30",
                  ].join(" ")}
                >
                  <span aria-hidden="true">{isDone ? "✓" : i + 1}</span>
                  {title}
                </Link>
              </li>
            );
          })}
        </ol>

        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-brand-green/10">
          <div
            className="h-full rounded-full bg-brand-green transition-all"
            style={{ width: `${(completed / total) * 100}%` }}
          />
        </div>

        <main className="mt-8 rounded-card bg-white border border-brand-green/10 p-6 sm:p-8">
          {children}
        </main>

        {/* Navigation. The forward control is the point of the screen: the
            previous version ended at a Save button and left the owner with no
            idea what came next. */}
        <nav className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            {step > 0 ? (
              <Link
                href={`/dashboard/setup?step=${prev}`}
                className="text-sm text-brand-olive hover:text-brand-green"
              >
                ← Back
              </Link>
            ) : null}
          </div>

          <div className="flex items-center gap-4">
            <Link
              href="/dashboard"
              className="text-sm text-brand-olive hover:text-brand-green underline-offset-4 hover:underline"
            >
              {allDone ? "Go to my dashboard" : "Skip for now"}
            </Link>
            {step < total - 1 ? (
              <Link
                href={`/dashboard/setup?step=${next}`}
                className="rounded-full bg-brand-green px-5 py-2.5 text-sm text-brand-cream hover:bg-brand-green-deep transition-colors"
              >
                {done[step] === true ? "Next step →" : "Skip this step →"}
              </Link>
            ) : (
              <Link
                href="/dashboard"
                className="rounded-full bg-brand-green px-5 py-2.5 text-sm text-brand-cream hover:bg-brand-green-deep transition-colors"
              >
                Finish →
              </Link>
            )}
          </div>
        </nav>
      </div>
    </div>
  );
}
