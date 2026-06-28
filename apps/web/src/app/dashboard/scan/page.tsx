import { requireSession } from "@/lib/session";
import { DashboardShell } from "../dashboard-shell";
import { ScanClient } from "./scan-client";

export const dynamic = "force-dynamic";

export default async function ScanPage(): Promise<JSX.Element> {
  const { user, merchant, preferences } = await requireSession();
  return (
    <DashboardShell
      user={user}
      merchant={merchant}
      isPremium={preferences.isPremium}
      breadcrumb={`${merchant.businessName} · Staff mode`}
      title="Stamp & scan"
    >
      <div className="max-w-3xl">
        <div className="rounded-card bg-white border border-brand-green/10 p-6">
          <p className="text-sm text-brand-olive">
            Open the customer&apos;s wallet pass, point the camera at the QR
            code. Stamp cards auto-stamp; points cards prompt for the bill
            amount.
          </p>
          <div className="mt-5">
            <ScanClient />
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
