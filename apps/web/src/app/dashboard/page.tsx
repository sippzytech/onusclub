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
        <h2 className="text-lg font-medium text-gray-900">Stamp programs</h2>
        {programs.length === 0 ? (
          <p className="text-sm text-gray-600">No programs yet. Create your first one below.</p>
        ) : (
          <ul className="space-y-2">
            {programs.map((p) => {
              const cfg = p.configJson as { stamps_required?: number } | null;
              const expiry = (p.configJson as { expiry_days?: number } | null)
                ?.expiry_days;
              return (
                <li
                  key={p.id}
                  className="rounded-md border border-gray-200 bg-white p-4 text-sm"
                >
                  <div className="font-medium text-gray-900">{p.name}</div>
                  <div className="text-gray-600 mt-1">
                    {cfg?.stamps_required ?? "?"} stamps → {p.rewardText}
                  </div>
                  {expiry ? (
                    <div className="text-xs text-gray-500 mt-1">
                      Expires after {expiry} days of inactivity
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
