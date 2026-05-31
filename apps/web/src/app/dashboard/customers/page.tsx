import type { Customer } from "@stampdeck/shared";
import { apiFetch } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { DashboardShell } from "../dashboard-shell";
import { AddCustomerForm } from "./add-customer-form";

export const dynamic = "force-dynamic";

export default async function CustomersPage(): Promise<JSX.Element> {
  const { jwt, user, merchant } = await requireSession();
  const { customers } = await apiFetch<{ customers: Customer[] }>("/v1/customers", { jwt });

  return (
    <DashboardShell user={user} merchant={merchant}>
      <section className="space-y-4">
        <h2 className="text-lg font-medium text-gray-900">Customers</h2>
        {customers.length === 0 ? (
          <p className="text-sm text-gray-600">No customers yet. Add your first one below.</p>
        ) : (
          <ul className="space-y-2">
            {customers.map((c) => (
              <li
                key={c.id}
                className="rounded-md border border-gray-200 bg-white p-4 text-sm"
              >
                <div className="font-medium text-gray-900">{c.name ?? "(no name)"}</div>
                <div className="text-gray-600 mt-1">
                  {[c.phone, c.email].filter(Boolean).join(" · ") || "—"}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3 mt-10">
        <h2 className="text-lg font-medium text-gray-900">Add a customer</h2>
        <AddCustomerForm />
      </section>
    </DashboardShell>
  );
}
