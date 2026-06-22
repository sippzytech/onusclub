"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { Card } from "@onusclub/shared";

interface StampState {
  busy: boolean;
  err: string | null;
}

export function CardsList({ cards }: { cards: Card[] }): JSX.Element {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [stampState, setStampState] = useState<Record<string, StampState>>({});

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return cards;
    return cards.filter((c) =>
      [c.customerName, c.programName, c.rewardText]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(q))
    );
  }, [cards, query]);

  async function quickStamp(c: Card): Promise<void> {
    setStampState((s) => ({ ...s, [c.id]: { busy: true, err: null } }));
    const res = await fetch(`/api/cards/${c.id}/stamp`, { method: "POST" });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setStampState((s) => ({
        ...s,
        [c.id]: { busy: false, err: body.error ?? "stamp failed" },
      }));
      return;
    }
    setStampState((s) => ({ ...s, [c.id]: { busy: false, err: null } }));
    router.refresh();
  }

  if (cards.length === 0) {
    return (
      <p className="text-sm text-gray-600">
        No cards yet. Enrol a customer into a program below.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by customer or program…"
        className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
      />
      {filtered.length === 0 ? (
        <p className="text-sm text-gray-600">No matches.</p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((c) => {
            const state = c.cardState as
              | { stamps_current?: number; rewards_redeemed?: number }
              | null;
            const cur = state?.stamps_current ?? 0;
            const eligible = cur >= c.stampsRequired;
            const expired = c.status === "expired";
            const s = stampState[c.id] ?? { busy: false, err: null };
            return (
              <li
                key={c.id}
                className={
                  "rounded-md border bg-white p-4 text-sm " +
                  (expired ? "border-gray-200 opacity-70" : "border-gray-200")
                }
              >
                <div className="flex items-center justify-between gap-4">
                  <Link href={`/dashboard/cards/${c.id}`} className="block flex-1 hover:underline">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">
                        {c.customerName ?? "(no name)"}
                      </span>
                      {expired ? (
                        <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-700">
                          Expired
                        </span>
                      ) : null}
                    </div>
                    <div className="text-gray-600 mt-1">{c.programName}</div>
                  </Link>
                  <div className="text-right shrink-0 mr-2">
                    <div className="text-2xl font-semibold tabular-nums text-gray-900">
                      {cur}
                      <span className="text-gray-400">/{c.stampsRequired}</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {state?.rewards_redeemed ?? 0} redeemed
                    </div>
                  </div>
                  <button
                    onClick={() => void quickStamp(c)}
                    disabled={s.busy || eligible || expired}
                    title={
                      expired
                        ? "Card is expired"
                        : eligible
                        ? "At threshold — open the card to redeem"
                        : "Add one stamp"
                    }
                    className="rounded-md bg-gray-900 px-3 py-2 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-40 shrink-0"
                  >
                    {s.busy ? "…" : "+1 stamp"}
                  </button>
                </div>
                {s.err ? (
                  <div className="mt-2 text-xs text-red-700">{s.err}</div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
