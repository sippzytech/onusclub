import Link from "next/link";
import type { CardDesign, Program } from "@onusclub/shared";
import { apiFetch } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { CreateProgramForm } from "../create-program-form";
import { DashboardShell } from "../dashboard-shell";
import { QrShareCard } from "../qr-share-card";
import { DesignEditor } from "./design-editor";

export const dynamic = "force-dynamic";

function publicUrlFor(slug: string): string {
  const base = process.env.NEXT_PUBLIC_WEB_BASE ?? "http://localhost:3001";
  return `${base.replace(/\/$/, "")}/m/${slug}`;
}

export default async function CardBuilderPage(): Promise<JSX.Element> {
  const { jwt, user, merchant, publicSlug, preferences, trial } = await requireSession();
  const { programs } = await apiFetch<{ programs: Program[] }>("/v1/programs", { jwt });

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
        {publicSlug ? (
          <div className="rounded-card bg-white border border-brand-green/10 p-6">
            <QrShareCard publicUrl={publicUrlFor(publicSlug)} />
          </div>
        ) : null}

        {/* Programs */}
        <div className="rounded-card bg-white border border-brand-green/10 p-6">
          <h2 className="font-serif text-2xl text-brand-green">Your programs</h2>
          {programs.length === 0 ? (
            <p className="text-sm text-brand-olive mt-3">
              No programs yet. Create your first one below.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-brand-green/10">
              {programs.map((p) => {
                const cfg = p.configJson as
                  | {
                      stamps_required?: number;
                      expiry_days?: number;
                      points_per_euro?: number;
                      points_for_reward?: number;
                      batch_expiry_days?: number;
                      design?: Partial<CardDesign>;
                    }
                  | null;
                const isPoints = p.programType === "points";
                const target = isPoints
                  ? (cfg?.points_for_reward ?? 0)
                  : (cfg?.stamps_required ?? 0);
                return (
                  <li key={p.id} className="py-6 first:pt-0 last:pb-0">
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
          )}
        </div>

        {/* Create program */}
        <div>
          <h2 className="font-serif text-2xl text-brand-green mb-3">
            Create a new program
          </h2>
          <CreateProgramForm />
        </div>

        {/* What the designer does not cover yet */}
        <div className="rounded-card border border-dashed border-brand-green/20 bg-brand-cream/50 p-6 text-center">
          <p className="font-serif text-xl text-brand-green">Still to come</p>
          <p className="text-sm text-brand-olive mt-2 max-w-md mx-auto">
            Logo upload, industry templates, and illustrated background motifs.
            Your design already applies to the customer&apos;s card page and to
            Apple Wallet passes. Google Wallet still uses the default styling.
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
