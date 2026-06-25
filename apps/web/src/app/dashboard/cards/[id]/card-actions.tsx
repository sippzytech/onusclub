"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Props {
  cardId: string;
  eligible: boolean;
  programType: "stamp" | "points";
  // For points programs only. Used to preview "€10 → 100 points" inline.
  pointsPerEuro?: number | null;
}

export function CardActions({ cardId, eligible, programType, pointsPerEuro }: Props): JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState<"stamp" | "redeem" | "points" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState<string>(""); // points-mode bill amount

  async function stampAct(): Promise<void> {
    setPending("stamp");
    setError(null);
    const res = await fetch(`/api/cards/${cardId}/stamp`, { method: "POST" });
    setPending(null);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "could not stamp");
      return;
    }
    router.refresh();
  }

  async function redeemAct(): Promise<void> {
    setPending("redeem");
    setError(null);
    const res = await fetch(`/api/cards/${cardId}/redeem`, { method: "POST" });
    setPending(null);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "could not redeem");
      return;
    }
    router.refresh();
  }

  async function pointsAct(): Promise<void> {
    const num = Number(amount);
    if (!num || num <= 0) {
      setError("enter a transaction amount in euros");
      return;
    }
    setPending("points");
    setError(null);
    const res = await fetch(`/api/cards/${cardId}/add-points`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount: num }),
    });
    setPending(null);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "could not add points");
      return;
    }
    setAmount("");
    router.refresh();
  }

  const previewPoints =
    programType === "points" && pointsPerEuro && Number(amount) > 0
      ? Math.floor(Number(amount) * pointsPerEuro)
      : null;

  return (
    <div className="space-y-3">
      {programType === "points" ? (
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-600">Transaction amount (€)</label>
            <input
              type="number"
              step="0.01"
              min={0.01}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="25.00"
              className="mt-1 block w-40 rounded-md border border-gray-300 px-3 py-2 text-sm tabular-nums"
            />
          </div>
          <button
            onClick={() => void pointsAct()}
            disabled={pending !== null || !amount}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {pending === "points" ? "Adding…" : "Add transaction"}
          </button>
          {previewPoints !== null ? (
            <p className="text-xs text-gray-600">
              = <span className="font-medium">{previewPoints}</span> points
            </p>
          ) : null}
          <button
            onClick={() => void redeemAct()}
            disabled={pending !== null || !eligible}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {pending === "redeem" ? "Redeeming…" : "Redeem reward"}
          </button>
        </div>
      ) : (
        <div className="flex gap-3">
          <button
            onClick={() => void stampAct()}
            disabled={pending !== null || eligible}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {pending === "stamp" ? "Stamping…" : "Add stamp"}
          </button>
          <button
            onClick={() => void redeemAct()}
            disabled={pending !== null || !eligible}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {pending === "redeem" ? "Redeeming…" : "Redeem reward"}
          </button>
        </div>
      )}

      {eligible ? (
        <p className="text-xs text-emerald-700">
          {programType === "points"
            ? "Balance is at or above the reward threshold — redeem when ready."
            : "Card is at the threshold — redeem the reward before adding more stamps."}
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
