import type { EmailHealth, MerchantBranding, ShopLocation } from "@onusclub/shared";
import { apiFetch } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { DashboardShell } from "../dashboard-shell";
import { BrandingForm } from "./branding-form";
import { LocationsForm } from "./locations-form";
import { EmailHealthPanel } from "./email-health";

export const dynamic = "force-dynamic";

export default async function SettingsPage(): Promise<JSX.Element> {
  const { jwt, user, merchant, preferences, trial } = await requireSession();
  const [branding, locations] = await Promise.all([
    apiFetch<MerchantBranding>("/v1/me/branding", { jwt }),
    apiFetch<{ locations: ShopLocation[]; maxLocations: number }>("/v1/locations", { jwt }),
  ]);

  // Allowed to fail: depends on migration 013, and this page must still render
  // on a box that has the code but not the migration. Same rule as the
  // analytics fetch on the Overview page.
  const emailHealth = await apiFetch<EmailHealth>("/v1/me/email-health", { jwt }).catch(
    () => null
  );

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

        <section className="rounded-card bg-white border border-brand-green/10 p-6">
          <h2 className="font-serif text-2xl text-brand-green">Email</h2>
          <p className="text-sm text-brand-olive mt-1">
            Whether the card links and sign-in emails we send on your behalf are getting
            through.
          </p>
          <div className="mt-5">
            <EmailHealthPanel health={emailHealth} />
          </div>
        </section>
      </div>
    </DashboardShell>
  );
}
