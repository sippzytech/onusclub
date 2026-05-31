import Link from "next/link";
import type { Card, Customer, Program } from "@stampdeck/shared";
import { apiFetch } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { DashboardShell } from "../dashboard-shell";
import { CardsList } from "./cards-list";
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
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium text-gray-900">Cards</h2>
          <Link
            href="/dashboard/scan"
            className="text-sm text-gray-700 underline hover:text-gray-900"
          >
            Scan QR →
          </Link>
        </div>
        <CardsList cards={cards} />
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
