"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CardActions({
  cardId,
  eligible,
}: {
  cardId: string;
  eligible: boolean;
}): JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState<"stamp" | "redeem" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(kind: "stamp" | "redeem"): Promise<void> {
    setPending(kind);
    setError(null);
    const res = await fetch(`/api/cards/${cardId}/${kind}`, { method: "POST" });
    setPending(null);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? `could not ${kind}`);
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        <button
          onClick={() => void act("stamp")}
          disabled={pending !== null || eligible}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {pending === "stamp" ? "Stamping…" : "Add stamp"}
        </button>
        <button
          onClick={() => void act("redeem")}
          disabled={pending !== null || !eligible}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {pending === "redeem" ? "Redeeming…" : "Redeem reward"}
        </button>
      </div>
      {eligible ? (
        <p className="text-xs text-emerald-700">
          Card is at the threshold — redeem the reward before adding more stamps.
        </p>
      ) : null}
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}
    </div>
  );
}
