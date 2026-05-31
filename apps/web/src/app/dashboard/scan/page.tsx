import { requireSession } from "@/lib/session";
import { DashboardShell } from "../dashboard-shell";
import { ScanClient } from "./scan-client";

export const dynamic = "force-dynamic";

export default async function ScanPage(): Promise<JSX.Element> {
  const { user, merchant } = await requireSession();
  return (
    <DashboardShell user={user} merchant={merchant}>
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-medium text-gray-900">Scan a customer&apos;s pass</h2>
          <p className="text-sm text-gray-600 mt-1">
            Open the customer&apos;s Google Wallet pass, point the camera at the QR code, and
            we&apos;ll add a stamp (or redeem if they&apos;re at the reward).
          </p>
        </div>
        <ScanClient />
      </div>
    </DashboardShell>
  );
}
