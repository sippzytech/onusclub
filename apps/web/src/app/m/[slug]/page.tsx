import { notFound } from "next/navigation";
import type { PublicMerchant } from "@onusclub/shared";
import { ApiCallError, apiFetch } from "@/lib/api";
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

  const brand = merchant.brandColor ?? "#111111";

  return (
    <main className="min-h-screen flex items-stretch">
      <div className="flex-1 flex flex-col items-center px-6 py-12 max-w-md mx-auto w-full">
        <div className="w-full space-y-6">
          <header
            className="rounded-xl p-6 text-white shadow-sm"
            style={{ backgroundColor: brand }}
          >
            <p className="text-xs uppercase tracking-wide opacity-80">Loyalty card</p>
            <h1 className="text-2xl font-semibold mt-1">{merchant.businessName}</h1>
            {merchant.programs.length === 1 ? (
              <p className="text-sm mt-2 opacity-90">
                Collect {merchant.programs[0].stampsRequired} stamps →{" "}
                {merchant.programs[0].rewardText}
              </p>
            ) : (
              <p className="text-sm mt-2 opacity-90">
                Pick your card below and earn rewards.
              </p>
            )}
          </header>

          {merchant.programs.length === 0 ? (
            <div className="rounded-md border border-gray-200 bg-white p-4 text-sm text-gray-700">
              {merchant.businessName} hasn&apos;t set up any loyalty programs yet.
              Please check back soon!
            </div>
          ) : (
            <PublicEnrolForm slug={merchant.publicSlug} programs={merchant.programs} />
          )}

          <p className="text-xs text-gray-500 text-center">
            Powered by OnUsClub · No app needed — the card lives in your Google Wallet.
          </p>
        </div>
      </div>
    </main>
  );
}
