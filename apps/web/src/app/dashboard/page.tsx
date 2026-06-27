import type { Program } from "@onusclub/shared";
import { apiFetch } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { CreateProgramForm } from "./create-program-form";
import { DashboardShell } from "./dashboard-shell";
import { QrShareCard } from "./qr-share-card";

export const dynamic = "force-dynamic";

function publicUrlFor(slug: string): string {
  const base = process.env.NEXT_PUBLIC_WEB_BASE ?? "http://localhost:3001";
  return `${base.replace(/\/$/, "")}/m/${slug}`;
}

export default async function DashboardPage(): Promise<JSX.Element> {
  const { jwt, user, merchant, publicSlug } = await requireSession();
  const { programs } = await apiFetch<{ programs: Program[] }>("/v1/programs", { jwt });

  return (
    <DashboardShell user={user} merchant={merchant}>
      {publicSlug ? (
        <section className="mb-12">
          <QrShareCard publicUrl={publicUrlFor(publicSlug)} />
        </section>
      ) : null}

      <section className="space-y-4">
        <h2 className="text-lg font-medium text-gray-900">Programs</h2>
        {programs.length === 0 ? (
          <p className="text-sm text-gray-600">No programs yet. Create your first one below.</p>
        ) : (
          <ul className="space-y-2">
            {programs.map((p) => {
              const cfg = p.configJson as
                | {
                    stamps_required?: number;
                    expiry_days?: number;
                    points_per_euro?: number;
                    points_for_reward?: number;
                    batch_expiry_days?: number;
                  }
                | null;
              const isPoints = p.programType === "points";
              return (
                <li
                  key={p.id}
                  className="rounded-md border border-gray-200 bg-white p-4 text-sm"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900">{p.name}</span>
                    {isPoints ? (
                      <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">
                        Points
                      </span>
                    ) : null}
                  </div>
                  <div className="text-gray-600 mt-1">
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
                  </div>
                  {isPoints && cfg?.batch_expiry_days ? (
                    <div className="text-xs text-gray-500 mt-1">
                      Points expire after {cfg.batch_expiry_days} days
                    </div>
                  ) : null}
                  {!isPoints && cfg?.expiry_days ? (
                    <div className="text-xs text-gray-500 mt-1">
                      Expires after {cfg.expiry_days} days of inactivity
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3 mt-10">
        <h2 className="text-lg font-medium text-gray-900">Create a new program</h2>
        <CreateProgramForm />
      </section>
    </DashboardShell>
  );
}
