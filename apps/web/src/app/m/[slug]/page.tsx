import { notFound } from "next/navigation";
import type { PublicMerchant } from "@onusclub/shared";
import { ApiCallError, apiFetch } from "@/lib/api";
import { googleClientId } from "@/lib/google";
import { PublicEnrolForm } from "./enrol-form";

export const dynamic = "force-dynamic";

export default async function PublicMerchantPage({
  params,
}: {
  params: { slug: string };
}): Promise<JSX.Element> {
  let merchant: PublicMerchant;
  try {
    merchant = await apiFetch<PublicMerchant>(`/v1/public/m/${params.slug}`);
  } catch (err) {
    if (err instanceof ApiCallError && err.status === 404) notFound();
    throw err;
  }

  return (
    <main className="min-h-screen flex items-stretch bg-brand-cream">
      <div className="flex-1 flex flex-col items-center px-6 py-12 max-w-md mx-auto w-full">
        <div className="w-full space-y-4">
          <header
            className="rounded-card p-6 text-brand-cream shadow-sm"
            style={{ backgroundColor: merchant.brandColor ?? "#14271C" }}
          >
            <p className="text-xs uppercase tracking-wider opacity-80">
              Loyalty card
            </p>
            <h1 className="font-serif text-3xl mt-1">{merchant.businessName}</h1>
            {merchant.programs.length === 1 ? (
              <p className="text-sm mt-2 opacity-90">
                Collect {merchant.programs[0].stampsRequired} stamps →{" "}
                {merchant.programs[0].rewardText}
              </p>
            ) : merchant.programs.length > 1 ? (
              <p className="text-sm mt-2 opacity-90">
                Pick your card below and earn rewards.
              </p>
            ) : null}
          </header>

          {merchant.programs.length === 0 ? (
            <div className="rounded-card bg-white border border-brand-green/10 p-4 text-sm text-brand-green">
              {merchant.businessName} hasn&apos;t set up any loyalty programs
              yet. Please check back soon!
            </div>
          ) : (
            <div className="rounded-card bg-white border border-brand-green/10 p-5">
              <PublicEnrolForm
                slug={merchant.publicSlug}
                programs={merchant.programs}
                googleClientId={googleClientId()}
                // Read HERE, in a server component, and passed down — the same
                // rule as the Google client id. A client component reading
                // NEXT_PUBLIC_* gets the build-time value, which is empty in
                // production. See lib/google.ts.
                apiBase={
                  process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, "") ??
                  "http://localhost:4000"
                }
              />
            </div>
          )}

          <p className="text-xs text-brand-olive text-center">
            Powered by{" "}
            <a
              href="https://onusclub.com"
              className="hover:text-brand-green underline-offset-4 hover:underline"
            >
              OnUsClub
            </a>{" "}
            · No app needed — the card lives in your phone wallet.
          </p>
        </div>
      </div>
    </main>
  );
}
