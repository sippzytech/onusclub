"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { MerchantReviewSettings } from "@onusclub/shared";

/**
 * Google review settings.
 *
 * ⚠️ There is no "reward for a review" option here, and there must never be
 * one. Google's Fake Engagement policy prohibits incentivising reviews and
 * names loyalty points explicitly; "review gating" — asking only the customers
 * who say they enjoyed it — is banned separately. The penalties land on the
 * CAFÉ'S listing: reviews removed, a warning badge, a block on new reviews.
 *
 * The note below says so in the UI on purpose, so nobody adds a reward later
 * believing its absence was an oversight.
 */
export function ReviewsForm({ initial }: { initial: MerchantReviewSettings }): JSX.Element {
  const router = useRouter();
  const [link, setLink] = useState(initial.reviewUrl ?? "");
  const [settings, setSettings] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function patch(body: Record<string, unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/me/reviews", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { settings?: MerchantReviewSettings; error?: string };
      if (!res.ok || !data.settings) {
        setError(data.error ?? "Could not save.");
        return;
      }
      setSettings(data.settings);
      setLink(data.settings.reviewUrl ?? "");
      setSaved(true);
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <label htmlFor="review-link" className="block text-sm font-medium text-brand-green">
          Your Google review link
        </label>
        <p className="text-xs text-brand-olive mt-1">
          Search your own business name on Google while signed in, press{" "}
          <strong>Ask for reviews</strong>, and paste the link it gives you. It looks like{" "}
          <span className="font-mono">https://g.page/r/…/review</span>.
        </p>
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <input
            id="review-link"
            type="url"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://g.page/r/…/review"
            className="flex-1 min-w-[18rem] rounded-lg border border-brand-green/20 px-3 py-2 text-sm text-brand-green"
          />
          <button
            type="button"
            disabled={busy || !link.trim()}
            onClick={() => patch({ reviewLink: link.trim() })}
            className="px-4 py-2 rounded-full bg-brand-green text-brand-cream text-sm disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save link"}
          </button>
          {settings.reviewUrl && (
            <button
              type="button"
              disabled={busy}
              onClick={() => patch({ reviewLink: null })}
              className="text-xs text-brand-olive underline"
            >
              Remove
            </button>
          )}
        </div>
      </div>

      {settings.reviewUrl && (
        <label className="flex items-start gap-2 text-sm text-brand-green">
          <input
            type="checkbox"
            checked={settings.enabled}
            disabled={busy}
            onChange={(e) => patch({ enabled: e.target.checked })}
            className="mt-0.5"
          />
          <span>
            Ask customers for a review after they claim a reward
            <span className="block text-xs text-brand-olive">
              Shown on their card for two weeks after each reward, to everyone — not just
              the people who seemed happy.
            </span>
          </span>
        </label>
      )}

      {settings.enabled && (
        <p className="text-sm text-brand-green">
          <strong>{settings.clicksLast30Days}</strong>{" "}
          {settings.clicksLast30Days === 1 ? "customer has" : "customers have"} tapped
          through in the last 30 days.
          {/* Said plainly: a tap is not a review. Google reports nothing back,
              so this is the only number that exists and it must not be dressed
              up as something stronger. */}
          <span className="block text-xs text-brand-olive mt-0.5">
            That counts taps, not reviews — Google doesn&apos;t tell anyone which reviews
            came from where.
          </span>
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {saved && !error && <p className="text-sm text-emerald-700">Saved.</p>}

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
        <p className="font-medium">We never offer anything in return for a review.</p>
        <p className="mt-1">
          Google bans rewarding reviews — discounts, free items and loyalty points are all
          named in their policy — and the penalty lands on <strong>your</strong> Google
          listing, not ours: reviews removed, a warning on your profile, or a block on new
          reviews. Asking is fine. Paying is not.
        </p>
      </div>
    </div>
  );
}
