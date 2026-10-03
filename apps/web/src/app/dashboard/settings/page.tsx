import type { MerchantBranding } from "@onusclub/shared";
import { apiFetch } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { DashboardShell } from "../dashboard-shell";
import { BrandingForm } from "./branding-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage(): Promise<JSX.Element> {
  const { jwt, user, merchant, preferences, trial } = await requireSession();
  const branding = await apiFetch<MerchantBranding>("/v1/me/branding", { jwt });

  return (
    <DashboardShell
      trial={trial}
      user={user}
      merchant={merchant}
      isPremium={preferences.isPremium}
      breadcrumb={`${merchant.businessName} · Settings`}
      title="Settings"
    >
      <div className="max-w-2xl space-y-4">
        <section className="rounded-card bg-white border border-brand-green/10 p-6">
          <h2 className="font-serif text-2xl text-brand-green">Branding</h2>
          <p className="text-sm text-brand-olive mt-1">
            How your business appears on your customers&apos; phones.
          </p>
          <div className="mt-5">
            <BrandingForm initial={branding} />
          </div>
        </section>
      </div>
    </DashboardShell>
  );
}
