import type { Program } from "@stampdeck/shared";
import { apiFetch } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { CreateProgramForm } from "./create-program-form";
import { DashboardShell } from "./dashboard-shell";

export const dynamic = "force-dynamic";

export default async function DashboardPage(): Promise<JSX.Element> {
  const { jwt, user, merchant } = await requireSession();
  const { programs } = await apiFetch<{ programs: Program[] }>("/v1/programs", { jwt });

  return (
    <DashboardShell user={user} merchant={merchant}>
      <section className="space-y-4">
        <h2 className="text-lg font-medium text-gray-900">Stamp programs</h2>
        {programs.length === 0 ? (
          <p className="text-sm text-gray-600">No programs yet. Create your first one below.</p>
        ) : (
          <ul className="space-y-2">
            {programs.map((p) => {
              const cfg = p.configJson as { stamps_required?: number } | null;
              return (
                <li
                  key={p.id}
                  className="rounded-md border border-gray-200 bg-white p-4 text-sm"
                >
                  <div className="font-medium text-gray-900">{p.name}</div>
                  <div className="text-gray-600 mt-1">
                    {cfg?.stamps_required ?? "?"} stamps → {p.rewardText}
                  </div>
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
