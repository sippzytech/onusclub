import type { ReactNode } from "react";
import type { Merchant, SessionUser } from "@onusclub/shared";
import { DashboardNav } from "./dashboard-nav";
import { LogoutButton } from "./logout-button";

export function DashboardShell({
  user,
  merchant,
  children,
}: {
  user: SessionUser;
  merchant: Merchant;
  children: ReactNode;
}): JSX.Element {
  return (
    <main className="min-h-screen">
      <div className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-4xl px-6 py-4 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">Merchant</p>
            <h1 className="text-lg font-semibold text-gray-900">{merchant.businessName}</h1>
          </div>
          <div className="flex items-center gap-4 text-sm text-gray-600">
            <span>
              {user.email} · {merchant.status}
            </span>
            <LogoutButton />
          </div>
        </div>
        <div className="mx-auto max-w-4xl px-6">
          <DashboardNav />
        </div>
      </div>
      <div className="mx-auto max-w-4xl px-6 py-8">{children}</div>
    </main>
  );
}
