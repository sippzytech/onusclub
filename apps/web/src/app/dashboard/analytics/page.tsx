import { requireSession } from "@/lib/session";
import { DashboardShell } from "../dashboard-shell";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage(): Promise<JSX.Element> {
  const { user, merchant, preferences } = await requireSession();
  return (
    <DashboardShell
      user={user}
      merchant={merchant}
      isPremium={preferences.isPremium}
      breadcrumb={`${merchant.businessName} · Last 12 weeks`}
      title="Analytics"
    >
      <div className="space-y-6 max-w-5xl">
        <div className="rounded-card bg-white border border-brand-green/10 p-10 text-center">
          <p className="font-serif text-2xl text-brand-green">Coming soon</p>
          <p className="text-sm text-brand-olive mt-3 max-w-md mx-auto">
            Visits over time, new vs returning members, member journey
            conversion, and busiest hours — all on the way. For now, see
            the Overview page for headline numbers.
          </p>
        </div>
      </div>
    </DashboardShell>
  );
}
