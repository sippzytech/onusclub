import type { Customer } from "@onusclub/shared";
import { apiFetch } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { DashboardShell } from "../dashboard-shell";
import { AddCustomerForm } from "./add-customer-form";
import { CustomersList } from "./customers-list";

export const dynamic = "force-dynamic";

export default async function CustomersPage(): Promise<JSX.Element> {
  const { jwt, user, merchant } = await requireSession();
  const { customers } = await apiFetch<{ customers: Customer[] }>("/v1/customers", { jwt });

  return (
    <DashboardShell user={user} merchant={merchant}>
      <section className="space-y-4">
        <h2 className="text-lg font-medium text-gray-900">Customers</h2>
        <CustomersList customers={customers} />
      </section>

      <section className="space-y-3 mt-10">
        <h2 className="text-lg font-medium text-gray-900">Add a customer</h2>
        <AddCustomerForm />
      </section>
    </DashboardShell>
  );
}
