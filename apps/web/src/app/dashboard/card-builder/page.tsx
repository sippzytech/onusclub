import Link from "next/link";
import type { CardDesign, Program } from "@onusclub/shared";
import { apiFetch } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { CreateProgramForm } from "../create-program-form";
import { DashboardShell } from "../dashboard-shell";
import { QrShareCard } from "../qr-share-card";
import { DesignEditor } from "./design-editor";

export const dynamic = "force-dynamic";

/**
 * ORDER ON THIS PAGE IS THE FEATURE.
 *
 * It used to open with the customer-signup QR code — before the café had an
 * offer, before there was a card for anyone to be given. A real owner's first
 * reaction was "the card is not created and the offer is not created, so why
 * is the QR first?", and he was right: the QR is the LAST step, not the first.
 * Handed it at the top, an owner reasonably concludes it is what they are
 * meant to deal with now.
 *
 * So the page follows the order the work actually happens in:
 *
 *   no offer yet   → make one. Nothing else is shown, because nothing else
 *                    is actionable yet.
 *   offer exists   → here is your card, change how it looks, then take the QR
 *                    to the counter.
 *
 * ⚠️ Do not move the QR back above the offer list "so it is easy to find".
 * It is easy to find once it is useful, and before that it is a distraction
 * pointing at a signup page with nothing to sign up to.
 */
function publicUrlFor(slug: string): string {
  const base = process.env.NEXT_PUBLIC_WEB_BASE ?? "http://localhost:3001";
  return `${base.replace(/\/$/, "")}/m/${slug}`;
}

interface ProgramConfig {
  stamps_required?: number;
  expiry_days?: number;
  points_per_euro?: number;
  points_for_reward?: number;
  batch_expiry_days?: number;
  design?: Partial<CardDesign>;
}

export default async function CardBuilderPage(): Promise<JSX.Element> {
  const { jwt, user, merchant, publicSlug, preferences, trial } = await requireSession();
  const { programs } = await apiFetch<{ programs: Program[] }>("/v1/programs", { jwt });

  const hasPrograms = programs.length > 0;

  return (
    <DashboardShell
      trial={trial}
      user={user}
      merchant={merchant}
      isPremium={preferences.isPremium}
      breadcrumb={`${merchant.businessName} · Design`}
      title="Card builder"
    >
      <div className="space-y-6">
        {!hasPrograms ? (
          /* ---------- Nothing exists yet: one job on the page ---------- */
          <div className="rounded-card bg-white border border-brand-green/10 p-6">
            <h2 className="font-serif text-2xl text-brand-green">
              Create your first offer
            </h2>
            <p className="text-sm text-brand-olive mt-2 max-w-xl">
              An offer is the deal you give your customers — for example{" "}
              <span className="text-brand-green">
                &ldquo;collect 6 stamps, get a free coffee&rdquo;
              </span>
              . Once it exists you can design the card and print your signup QR
              code.
            </p>
            <div className="mt-5">
              <CreateProgramForm />
            </div>
          </div>
        ) : (
          <>
            {/* ---------- 1. The card itself ---------- */}
            <div className="rounded-card bg-white border border-brand-green/10 p-6">
              <h2 className="font-serif text-2xl text-brand-green">Your offers</h2>
              <p className="text-sm text-brand-olive mt-1">
                This is what lands in your customer&apos;s phone. Change
                anything below and the preview updates as you go — nothing is
                saved until you press Save.
              </p>

              <ul className="mt-4 divide-y divide-brand-green/10">
                {programs.map((p) => {
                  const cfg = p.configJson as ProgramConfig | null;
                  const isPoints = p.programType === "points";
                  const target = isPoints
                    ? (cfg?.points_for_reward ?? 0)
                    : (cfg?.stamps_required ?? 0);
                  return (
                    <li key={p.id} className="py-6 first:pt-4 last:pb-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-brand-green">{p.name}</span>
                        {isPoints ? (
                          <span className="rounded-full bg-brand-gold/15 px-2 py-0.5 text-xs text-brand-green">
                            Points
                          </span>
                        ) : null}
                        <span className="text-sm text-brand-olive">
                          {isPoints ? (
                            <>
                              {cfg?.points_for_reward ?? "?"} points → {p.rewardText}
                              {cfg?.points_per_euro
                                ? ` · ${cfg.points_per_euro} pt / €1`
                                : ""}
                            </>
                          ) : (
                            <>
                              {cfg?.stamps_required ?? "?"} stamps → {p.rewardText}
                            </>
                          )}
                        </span>
                      </div>
                      {isPoints && cfg?.batch_expiry_days ? (
                        <p className="text-xs text-brand-olive/80 mt-1">
                          Points expire after {cfg.batch_expiry_days} days
                        </p>
                      ) : null}
                      {!isPoints && cfg?.expiry_days ? (
                        <p className="text-xs text-brand-olive/80 mt-1">
                          Expires after {cfg.expiry_days} days of inactivity
                        </p>
                      ) : null}

                      <div className="mt-4">
                        <DesignEditor
                          programId={p.id}
                          programName={p.name}
                          businessName={merchant.businessName}
                          rewardText={p.rewardText}
                          programType={isPoints ? "points" : "stamp"}
                          target={target}
                          initialDesign={cfg?.design ?? {}}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* ---------- 2. Only now, the QR ---------- */}
            {publicSlug ? (
              <div className="rounded-card bg-white border border-brand-green/10 p-6">
                <QrShareCard publicUrl={publicUrlFor(publicSlug)} />
              </div>
            ) : null}

            {/* ---------- 3. Secondary: another offer ---------- */}
            <details className="rounded-card bg-white border border-brand-green/10 p-6">
              <summary className="cursor-pointer font-serif text-xl text-brand-green">
                Add another offer
              </summary>
              <p className="text-sm text-brand-olive mt-2">
                Most cafés only need one. A second is useful if you want, say, a
                stamp card for coffee and a points card for lunch.
              </p>
              <div className="mt-4">
                <CreateProgramForm />
              </div>
            </details>
          </>
        )}

        <div className="rounded-card border border-dashed border-brand-green/20 bg-brand-cream/50 p-6 text-center">
          <p className="font-serif text-xl text-brand-green">Still to come</p>
          <p className="text-sm text-brand-olive mt-2 max-w-md mx-auto">
            Industry templates and illustrated background motifs. Your design
            already applies to the customer&apos;s card page and to both Apple
            Wallet and Google Wallet, and your logo from Settings appears on
            both.
          </p>
          <Link
            href="/dashboard"
            className="mt-4 inline-block text-xs text-brand-olive hover:text-brand-green underline-offset-4 hover:underline"
          >
            ← Back to Overview
          </Link>
        </div>
      </div>
    </DashboardShell>
  );
}
