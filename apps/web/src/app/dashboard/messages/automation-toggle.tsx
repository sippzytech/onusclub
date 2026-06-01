"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AutomationToggle({
  cronsEnabled,
}: {
  cronsEnabled: boolean;
}): JSX.Element {
  const router = useRouter();
  const [enabled, setEnabled] = useState(cronsEnabled);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(): Promise<void> {
    const next = !enabled;
    setEnabled(next); // optimistic
    setPending(true);
    setError(null);
    const res = await fetch("/api/me/preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cronsEnabled: next }),
    });
    setPending(false);
    if (!res.ok) {
      setEnabled(!next); // revert
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "could not update preferences");
      return;
    }
    router.refresh();
  }

  function downgrade(): void {
    void (async (): Promise<void> => {
      setPending(true);
      const res = await fetch("/api/me/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isPremium: false }),
      });
      setPending(false);
      if (!res.ok) return;
      router.refresh();
    })();
  }

  return (
    <div className="rounded-md border border-gray-200 bg-white p-4 flex items-start gap-4">
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
            ⭐ Premium · Active
          </span>
        </div>
        <p className="text-sm text-gray-700 mt-2">
          <strong>Automatic notifications</strong> — birthday greetings (08:00 daily)
          and inactivity nudges (10:00 daily, 30+ days unseen). Broadcasts are
          always available regardless of this switch.
        </p>
        {error ? (
          <p className="text-xs text-red-700 mt-1">{error}</p>
        ) : null}
        <button
          onClick={downgrade}
          className="text-xs text-gray-500 underline mt-2 hover:text-gray-800"
        >
          (Testing: lock premium again)
        </button>
      </div>
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={pending}
        role="switch"
        aria-checked={enabled}
        className={
          "relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50 " +
          (enabled ? "bg-emerald-600" : "bg-gray-300")
        }
      >
        <span
          className={
            "pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out " +
            (enabled ? "translate-x-5" : "translate-x-0")
          }
        />
      </button>
    </div>
  );
}
