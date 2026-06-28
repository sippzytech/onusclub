import type { Customer } from "@onusclub/shared";
import { apiFetch } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { DashboardShell } from "../dashboard-shell";
import { AddCustomerForm } from "./add-customer-form";
import { CustomersList } from "./customers-list";

export const dynamic = "force-dynamic";

export default async function CustomersPage(): Promise<JSX.Element> {
  const { jwt, user, merchant, preferences } = await requireSession();
  const { customers } = await apiFetch<{ customers: Customer[] }>("/v1/customers", { jwt });

  return (
    <DashboardShell
      user={user}
      merchant={merchant}
      isPremium={preferences.isPremium}
      breadcrumb={`${merchant.businessName} · ${customers.length} members`}
      title="Customers"
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <section className="lg:col-span-2 rounded-card bg-white border border-brand-green/10 p-6">
          <h2 className="font-serif text-2xl text-brand-green">All members</h2>
          <p className="text-sm text-brand-olive mt-1">{customers.length} total</p>
          <div className="mt-4">
            <CustomersList customers={customers} />
          </div>
        </section>

        <section className="rounded-card bg-white border border-brand-green/10 p-6">
          <h2 className="font-serif text-2xl text-brand-green">Add a customer</h2>
          <p className="text-sm text-brand-olive mt-1">Manual enrolment</p>
          <div className="mt-4">
            <AddCustomerForm />
          </div>
        </section>
      </div>
    </DashboardShell>
  );
}
