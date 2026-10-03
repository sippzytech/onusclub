"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AdminAdjustResult } from "@onusclub/shared";

/**
 * Balance correction.
 *
 * Deliberately two-step. This is the only control in the product that writes
 * to a café's data from outside their own account, and the result is visible
 * to them and to their customer. A single-click +1 next to a number is the
 * wrong affordance for that: the second step restates exactly what will
 * happen, in words, before anything is written.
 *
 * The reason field has no placeholder text that could be submitted as-is and
 * no default. It goes into the café's own activity feed verbatim, so it is
 * written for them to read, not for us.
 */
export function AdjustForm({
  cardId,
  unit,
  current,
  threshold,
}: {
  cardId: string;
  unit: "stamps" | "points";
  current: number;
  threshold: number | null;
}): JSX.Element {
  const router = useRouter();
  const [delta, setDelta] = useState<string>("");
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<AdminAdjustResult | null>(null);

  const parsed = Number(delta);
  const valid = Number.isInteger(parsed) && parsed !== 0 && reason.trim().length >= 3;
  const projected = current + (Number.isFinite(parsed) ? parsed : 0);

  // Mirrors the api's rules so the operator is told before the round trip, not
  // after. The api checks the same things — it does not trust this.
  const localProblem =
    !Number.isFinite(parsed) || parsed === 0
      ? null
      : projected < 0
        ? `That would take the balance below zero (currently ${current}).`
        : unit === "stamps" && threshold !== null && projected > threshold
          ? `That would leave ${projected} stamps on a ${threshold}-stamp card. Redeem the reward instead.`
          : null;

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/cards/${cardId}/adjust`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ delta: parsed, reason: reason.trim() }),
      });
      const data = (await res.json()) as { result?: AdminAdjustResult; error?: string };
      if (!res.ok || !data.result) {
        setError(data.error ?? "The adjustment was refused.");
        return;
      }
      setDone(data.result);
      setConfirming(false);
      setDelta("");
      setReason("");
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
        <p>
          Balance moved from <strong>{done.before}</strong> to <strong>{done.after}</strong>{" "}
          {done.unit}.
        </p>
        <p className="text-xs mt-1">
          The café can see this on their own dashboard, with the reason you gave.
        </p>
        <button
          type="button"
          onClick={() => setDone(null)}
          className="text-xs underline mt-2"
        >
          Make another adjustment
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-slate-600">
          <span className="block mb-1">Change by</span>
          <input
            type="number"
            step={1}
            value={delta}
            onChange={(e) => {
              setDelta(e.target.value);
              setConfirming(false);
            }}
            placeholder={unit === "points" ? "e.g. 50 or -50" : "e.g. 1 or -2"}
            className="w-36 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
          />
        </label>
        <label className="text-xs text-slate-600 flex-1 min-w-[16rem]">
          <span className="block mb-1">
            Why — the café sees this wording
          </span>
          <input
            type="text"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setConfirming(false);
            }}
            maxLength={500}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
          />
        </label>
      </div>

      {localProblem ? (
        <p className="text-sm text-red-700">{localProblem}</p>
      ) : Number.isFinite(parsed) && parsed !== 0 ? (
        <p className="text-sm text-slate-700">
          {current} → <strong>{projected}</strong> {unit}
          {threshold !== null && ` (of ${threshold})`}
        </p>
      ) : null}

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}

      {!confirming ? (
        <button
          type="button"
          disabled={!valid || localProblem !== null}
          onClick={() => setConfirming(true)}
          className="rounded-lg bg-slate-900 text-white px-4 py-2 text-sm disabled:opacity-40"
        >
          Review this change
        </button>
      ) : (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 space-y-3">
          {/* Restated in full, as a sentence. The operator should be agreeing
              to a specific described action, not to a form they already filled
              in. */}
          <p className="text-sm text-amber-900">
            This will change the balance from <strong>{current}</strong> to{" "}
            <strong>{projected}</strong> {unit} on a live customer&apos;s card, update their
            wallet pass, and appear on the café&apos;s own dashboard as:
          </p>
          <p className="text-sm text-amber-900 italic">
            “{parsed > 0 ? "+" : ""}
            {parsed} {unit} by OnUsClub support: {reason.trim()}”
          </p>
          <p className="text-xs text-amber-800">
            The customer is not sent a notification — their pass simply shows the
            corrected balance.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={submit}
              className="rounded-lg bg-amber-800 text-white px-4 py-2 text-sm disabled:opacity-50"
            >
              {busy ? "Applying…" : "Yes, apply it"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming(false)}
              className="rounded-lg border border-amber-300 px-4 py-2 text-sm text-amber-900"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
