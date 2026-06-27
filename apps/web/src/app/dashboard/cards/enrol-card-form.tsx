"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { Customer, Program } from "@onusclub/shared";

export function EnrolCardForm({
  customers,
  programs,
}: {
  customers: Customer[];
  programs: Program[];
}): JSX.Element {
  const router = useRouter();
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [programId, setProgramId] = useState(programs[0]?.id ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await fetch("/api/cards", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ customerId, programId }),
    });
    setPending(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "could not enrol card");
      return;
    }
    const { card } = (await res.json()) as { card: { id: string } };
    router.push(`/dashboard/cards/${card.id}`);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-md border border-gray-200 bg-white p-4">
      <div>
        <label className="block text-sm font-medium text-gray-800">Customer</label>
        <select
          required
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
          className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
        >
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name ?? "(no name)"} —{" "}
              {[c.phone, c.email].filter(Boolean).join(" / ") || "?"}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-800">Program</label>
        <select
          required
          value={programId}
          onChange={(e) => setProgramId(e.target.value)}
          className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
        >
          {programs.map((p) => {
            const cfg = p.configJson as
              | { stamps_required?: number; points_for_reward?: number }
              | null;
            const target =
              p.programType === "points"
                ? `${cfg?.points_for_reward ?? "?"} points`
                : `${cfg?.stamps_required ?? "?"} stamps`;
            return (
              <option key={p.id} value={p.id}>
                {p.name} — {target} → {p.rewardText}
              </option>
            );
          })}
        </select>
      </div>
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {pending ? "Enrolling…" : "Enrol card"}
      </button>
    </form>
  );
}
