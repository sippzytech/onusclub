"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function PremiumLock(): JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function unlock(): Promise<void> {
    setPending(true);
    setError(null);
    const res = await fetch("/api/me/preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ isPremium: true }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "could not unlock");
      setPending(false);
      return;
    }
    router.refresh();
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="bg-gradient-to-br from-gray-900 to-gray-700 px-6 py-8 text-white">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="inline-flex h-10 w-10 rounded-full bg-white/15 items-center justify-center text-xl"
          >
            🔒
          </span>
          <div>
            <p className="text-xs uppercase tracking-wide opacity-80">Premium feature</p>
            <h2 className="text-xl font-semibold">Customer messaging</h2>
          </div>
        </div>
        <p className="text-sm opacity-90 mt-4 max-w-lg">
          Reach every customer who has your loyalty card on their phone — without an
          app, an SMS plan, or an email list.
        </p>
      </div>

      <div className="p-6 space-y-5">
        <h3 className="text-sm font-medium text-gray-900">What you get</h3>
        <ul className="space-y-3 text-sm text-gray-800">
          <li className="flex gap-3">
            <span className="mt-0.5 text-emerald-600">✓</span>
            <span>
              <strong>Broadcasts.</strong> Send a push notification to every customer
              with one click. "Friday special", "new menu out", "we&apos;re closed for
              renovation".
            </span>
          </li>
          <li className="flex gap-3">
            <span className="mt-0.5 text-emerald-600">✓</span>
            <span>
              <strong>Birthday greetings.</strong> Daily cron — every customer whose
              birthday is today gets an automatic "happy birthday" with a bonus offer.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="mt-0.5 text-emerald-600">✓</span>
            <span>
              <strong>Inactivity nudges.</strong> Haven&apos;t seen a customer in 30 days?
              We send a gentle "we miss you" reminder to their pass.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="mt-0.5 text-emerald-600">✓</span>
            <span>
              <strong>Per-customer audit.</strong> See exactly who received each push,
              who failed, and retry failed ones with one click.
            </span>
          </li>
        </ul>

        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <strong>Testing mode:</strong> the unlock button below is free during the
          beta. We&apos;ll wire up real billing before public launch.
        </div>

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        <button
          onClick={() => void unlock()}
          disabled={pending}
          className="rounded-md bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {pending ? "Unlocking…" : "Try premium (free during testing)"}
        </button>
      </div>
    </div>
  );
}
