import type { MerchantBranding, ShopLocation } from "@onusclub/shared";
import { apiFetch } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { DashboardShell } from "../dashboard-shell";
import { BrandingForm } from "./branding-form";
import { LocationsForm } from "./locations-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage(): Promise<JSX.Element> {
  const { jwt, user, merchant, preferences, trial } = await requireSession();
  const [branding, locations] = await Promise.all([
    apiFetch<MerchantBranding>("/v1/me/branding", { jwt }),
    apiFetch<{ locations: ShopLocation[]; maxLocations: number }>("/v1/locations", { jwt }),
  ]);

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

        <section className="rounded-card bg-white border border-brand-green/10 p-6">
          <h2 className="font-serif text-2xl text-brand-green">Your locations</h2>
          <p className="text-sm text-brand-olive mt-1">
            So your card can appear on a customer&apos;s phone when they&apos;re nearby.
          </p>
          <div className="mt-5">
            <LocationsForm
              initial={locations.locations}
              maxLocations={locations.maxLocations}
            />
          </div>
        </section>
      </div>
    </DashboardShell>
  );
}
