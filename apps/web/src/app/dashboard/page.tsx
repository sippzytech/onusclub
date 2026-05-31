import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Merchant, Program, SessionUser } from "@stampdeck/shared";
import { apiFetch, SESSION_COOKIE } from "@/lib/api";
import { CreateProgramForm } from "./create-program-form";
import { LogoutButton } from "./logout-button";

export const dynamic = "force-dynamic";

export default async function DashboardPage(): Promise<JSX.Element> {
  const jwt = cookies().get(SESSION_COOKIE)?.value;
  if (!jwt) redirect("/login");

  let me: { user: SessionUser; merchant: Merchant };
  try {
    me = await apiFetch<{ user: SessionUser; merchant: Merchant }>("/v1/me", { jwt });
  } catch {
    redirect("/login?error=session_invalid");
  }

  const { programs } = await apiFetch<{ programs: Program[] }>("/v1/programs", { jwt });

  return (
    <main className="min-h-screen px-6 py-12">
      <div className="mx-auto max-w-3xl space-y-10">
        <header className="flex items-start justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">Merchant</p>
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
              {me.merchant.businessName}
            </h1>
            <p className="text-sm text-gray-600 mt-1">
              Signed in as {me.user.email} · {me.merchant.status}
            </p>
          </div>
          <LogoutButton />
        </header>

        <section className="space-y-4">
          <h2 className="text-lg font-medium text-gray-900">Stamp programs</h2>
          {programs.length === 0 ? (
            <p className="text-sm text-gray-600">
              No programs yet. Create your first one below.
            </p>
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

        <section className="space-y-3">
          <h2 className="text-lg font-medium text-gray-900">Create a new program</h2>
          <CreateProgramForm />
        </section>
      </div>
    </main>
  );
}
