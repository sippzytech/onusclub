"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AdminMerchantSummary } from "@onusclub/shared";

/**
 * The account levers.
 *
 * One form, one reason, one save — rather than a toggle per field that writes
 * immediately. Every one of these changes is audited and some are visible to
 * the café, so "what am I about to change, and why" should be a single
 * decision rather than six silent ones.
 *
 * Deliberately absent: deleting the café (the cascade reaches customers,
 * cards, events and points batches, and is irreversible — suspend instead),
 * editing programs or card design (that would change the deal for customers
 * who already hold a card), and changing the owner email (globally unique
 * across two tables).
 */
export function MerchantControls({ merchant }: { merchant: AdminMerchantSummary }): JSX.Element {
  const router = useRouter();

  const [businessName, setBusinessName] = useState(merchant.businessName);
  const [status, setStatus] = useState(merchant.status);
  const [isPremium, setIsPremium] = useState(merchant.isPremium);
  const [cronsEnabled, setCronsEnabled] = useState(merchant.cronsEnabled);
  const [trialEndsAt, setTrialEndsAt] = useState(merchant.trial.endsAt?.slice(0, 10) ?? "");
  const [fee, setFee] = useState(
    merchant.monthlyFeeCents === null ? "" : String(merchant.monthlyFeeCents / 100)
  );
  const [reason, setReason] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [resetReason, setResetReason] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetDone, setResetDone] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);

  // Only what actually changed is sent, so the audit row's before/after is
  // the real diff rather than every field restated.
  function changes(): Record<string, unknown> {
    const body: Record<string, unknown> = {};
    if (businessName.trim() !== merchant.businessName) body.businessName = businessName.trim();
    if (status !== merchant.status) body.status = status;
    if (isPremium !== merchant.isPremium) body.isPremium = isPremium;
    if (cronsEnabled !== merchant.cronsEnabled) body.cronsEnabled = cronsEnabled;

    const currentTrial = merchant.trial.endsAt?.slice(0, 10) ?? "";
    if (trialEndsAt !== currentTrial) {
      // Midday UTC rather than midnight: a trial that ends "on the 14th"
      // should not expire at 01:00 Amsterdam time on the 14th.
      body.trialEndsAt = trialEndsAt ? new Date(`${trialEndsAt}T12:00:00Z`).toISOString() : null;
    }

    const currentFee = merchant.monthlyFeeCents === null ? "" : String(merchant.monthlyFeeCents / 100);
    if (fee.trim() !== currentFee) {
      // Blank means "not recorded", not €0 — a café on a free pilot and a café
      // whose fee nobody wrote down are different facts.
      body.monthlyFeeCents = fee.trim() === "" ? null : Math.round(Number(fee) * 100);
    }
    return body;
  }

  const pending = changes();
  const dirty = Object.keys(pending).length > 0;

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/admin/merchants/${merchant.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...pending, reason: reason.trim() }),
      });
      const data = (await res.json()) as { merchant?: unknown; error?: string };
      if (!res.ok || !data.merchant) {
        setError(data.error ?? "The change was refused.");
        return;
      }
      setSaved(true);
      setReason("");
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function sendReset(): Promise<void> {
    setResetBusy(true);
    setResetError(null);
    setResetDone(null);
    try {
      const res = await fetch(`/api/admin/merchants/${merchant.id}/password-reset`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: resetReason.trim() }),
      });
      const data = (await res.json()) as {
        result?: { sentTo: string; devResetLink?: string };
        error?: string;
      };
      if (!res.ok || !data.result) {
        setResetError(data.error ?? "Could not send the reset link.");
        return;
      }
      setResetDone(data.result.devResetLink ?? `Sent to ${data.result.sentTo}.`);
      setResetReason("");
    } catch {
      setResetError("Could not reach the server.");
    } finally {
      setResetBusy(false);
    }
  }

  const field = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900";
  const label = "block text-xs text-slate-600";

  return (
    <div className="space-y-6">
      <div className="grid sm:grid-cols-2 gap-3">
        <label className={label}>
          <span className="block mb-1">Business name</span>
          <input
            type="text"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            className={field}
          />
        </label>

        <label className={label}>
          <span className="block mb-1">Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
            className={`${field} bg-white`}
          >
            <option value="trial">Trial</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
        </label>

        <label className={label}>
          <span className="block mb-1">Trial ends</span>
          <input
            type="date"
            value={trialEndsAt}
            onChange={(e) => setTrialEndsAt(e.target.value)}
            className={field}
          />
          <span className="block text-[11px] text-slate-400 mt-1">
            Clear the date to take them off the trial clock entirely.
          </span>
        </label>

        <label className={label}>
          <span className="block mb-1">Monthly fee (€)</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            placeholder="not recorded"
            className={field}
          />
          <span className="block text-[11px] text-slate-400 mt-1">
            What they agreed to pay. Leave blank for &ldquo;not recorded&rdquo; — that is
            different from €0.
          </span>
        </label>
      </div>

      <div className="flex flex-wrap gap-5">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={isPremium}
            onChange={(e) => setIsPremium(e.target.checked)}
          />
          Premium features unlocked
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={cronsEnabled}
            onChange={(e) => setCronsEnabled(e.target.checked)}
          />
          Daily sweeps enabled
          <span
            className="text-[11px] text-slate-400"
            title="Expiry, points expiry, birthday and win-back messages. Off means none of them run for this café."
          >
            (expiry, birthday, win-back)
          </span>
        </label>
      </div>

      <div className="border-t border-slate-100 pt-4">
        {dirty ? (
          <p className="text-xs text-slate-600 mb-2">
            Will change:{" "}
            <span className="text-slate-900">{Object.keys(pending).join(", ")}</span>
          </p>
        ) : (
          <p className="text-xs text-slate-400 mb-2">Nothing changed yet.</p>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <label className={`${label} flex-1 min-w-[16rem]`}>
            <span className="block mb-1">Why (recorded in the audit log)</span>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              className={field}
            />
          </label>
          <button
            type="button"
            disabled={busy || !dirty || reason.trim().length < 3}
            onClick={save}
            className="rounded-lg bg-slate-900 text-white px-4 py-2 text-sm disabled:opacity-40"
          >
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-700 mt-2">
            {error}
          </p>
        )}
        {saved && !error && <p className="text-sm text-emerald-700 mt-2">Saved.</p>}
      </div>

      <div className="border-t border-slate-100 pt-4">
        <h3 className="text-sm font-medium text-slate-900">Owner locked out?</h3>
        <p className="text-xs text-slate-500 mt-0.5 mb-2">
          Sends the ordinary reset link to <strong>{merchant.ownerEmail}</strong>. We never see
          or set their password — this is the same link they would get themselves.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className={`${label} flex-1 min-w-[16rem]`}>
            <span className="block mb-1">Why</span>
            <input
              type="text"
              value={resetReason}
              onChange={(e) => setResetReason(e.target.value)}
              maxLength={500}
              className={field}
            />
          </label>
          <button
            type="button"
            disabled={resetBusy || resetReason.trim().length < 3}
            onClick={sendReset}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:opacity-40"
          >
            {resetBusy ? "Sending…" : "Send reset link"}
          </button>
        </div>
        {resetError && (
          <p role="alert" className="text-sm text-red-700 mt-2">
            {resetError}
          </p>
        )}
        {resetDone && (
          <p className="text-sm text-emerald-700 mt-2 break-all">
            {resetDone}
            {/* Resend is still in test mode and only delivers to one address,
                so in development the link itself is returned. */}
          </p>
        )}
      </div>
    </div>
  );
}
