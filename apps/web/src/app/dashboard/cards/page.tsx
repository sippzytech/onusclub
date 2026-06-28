import Link from "next/link";
import type { Card, Customer, Program } from "@onusclub/shared";
import { apiFetch } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { DashboardShell } from "../dashboard-shell";
import { CardsList } from "./cards-list";
import { EnrolCardForm } from "./enrol-card-form";

export const dynamic = "force-dynamic";

export default async function CardsPage(): Promise<JSX.Element> {
  const { jwt, user, merchant, preferences } = await requireSession();
  const [{ cards }, { customers }, { programs }] = await Promise.all([
    apiFetch<{ cards: Card[] }>("/v1/cards", { jwt }),
    apiFetch<{ customers: Customer[] }>("/v1/customers", { jwt }),
    apiFetch<{ programs: Program[] }>("/v1/programs", { jwt }),
  ]);

  const activeCount = cards.filter((c) => c.status === "active").length;

  return (
    <DashboardShell
      user={user}
      merchant={merchant}
      isPremium={preferences.isPremium}
      breadcrumb={`${merchant.businessName} · ${activeCount} active cards`}
      title="Cards"
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <section className="lg:col-span-2 rounded-card bg-white border border-brand-green/10 p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-serif text-2xl text-brand-green">All cards</h2>
            <Link
              href="/dashboard/scan"
              className="text-sm text-brand-olive hover:text-brand-green underline-offset-4 hover:underline"
            >
              Scan QR →
            </Link>
          </div>
          <div className="mt-4">
            <CardsList cards={cards} />
          </div>
        </section>

        <section className="rounded-card bg-white border border-brand-green/10 p-6">
          <h2 className="font-serif text-2xl text-brand-green">Enrol a card</h2>
          <div className="mt-4">
            {customers.length === 0 || programs.length === 0 ? (
              <p className="text-sm text-brand-olive">
                Need at least one customer and one program first.{" "}
                {customers.length === 0 ? (
                  <Link href="/dashboard/customers" className="underline">
                    Add a customer
                  </Link>
                ) : null}
                {customers.length === 0 && programs.length === 0 ? " · " : null}
                {programs.length === 0 ? (
                  <Link href="/dashboard/card-builder" className="underline">
                    Create a program
                  </Link>
                ) : null}
                .
              </p>
            ) : (
              <EnrolCardForm customers={customers} programs={programs} />
            )}
          </div>
        </section>
      </div>
    </DashboardShell>
  );
}
