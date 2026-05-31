import Link from "next/link";
import type { Card, Customer, Program } from "@stampdeck/shared";
import { apiFetch } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { DashboardShell } from "../dashboard-shell";
import { EnrolCardForm } from "./enrol-card-form";

export const dynamic = "force-dynamic";

export default async function CardsPage(): Promise<JSX.Element> {
  const { jwt, user, merchant } = await requireSession();
  const [{ cards }, { customers }, { programs }] = await Promise.all([
    apiFetch<{ cards: Card[] }>("/v1/cards", { jwt }),
    apiFetch<{ customers: Customer[] }>("/v1/customers", { jwt }),
    apiFetch<{ programs: Program[] }>("/v1/programs", { jwt }),
  ]);

  return (
    <DashboardShell user={user} merchant={merchant}>
      <section className="space-y-4">
        <h2 className="text-lg font-medium text-gray-900">Cards</h2>
        {cards.length === 0 ? (
          <p className="text-sm text-gray-600">
            No cards yet. Enrol a customer into a program below.
          </p>
        ) : (
          <ul className="space-y-2">
            {cards.map((c) => {
              const state = c.cardState as
                | { stamps_current?: number; rewards_redeemed?: number }
                | null;
              const cur = state?.stamps_current ?? 0;
              return (
                <li key={c.id}>
                  <Link
                    href={`/dashboard/cards/${c.id}`}
                    className="block rounded-md border border-gray-200 bg-white p-4 text-sm hover:bg-gray-50"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-gray-900">
                          {c.customerName ?? "(no name)"}
                        </div>
                        <div className="text-gray-600 mt-1">{c.programName}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-2xl font-semibold tabular-nums text-gray-900">
                          {cur}
                          <span className="text-gray-400">/{c.stampsRequired}</span>
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          {state?.rewards_redeemed ?? 0} redeemed
                        </div>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3 mt-10">
        <h2 className="text-lg font-medium text-gray-900">Enrol a card</h2>
        {customers.length === 0 || programs.length === 0 ? (
          <p className="text-sm text-gray-600">
            You need at least one customer and one program before you can enrol a card.{" "}
            {customers.length === 0 ? (
              <Link href="/dashboard/customers" className="underline">
                Add a customer
              </Link>
            ) : null}
            {customers.length === 0 && programs.length === 0 ? " · " : null}
            {programs.length === 0 ? (
              <Link href="/dashboard" className="underline">
                Create a program
              </Link>
            ) : null}
            .
          </p>
        ) : (
          <EnrolCardForm customers={customers} programs={programs} />
        )}
      </section>
    </DashboardShell>
  );
}
