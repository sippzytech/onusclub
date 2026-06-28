"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { Card } from "@onusclub/shared";

interface StampState {
  busy: boolean;
  err: string | null;
}

function avatarColorFor(name: string): string {
  const palette = [
    "bg-brand-green",
    "bg-brand-olive",
    "bg-[#3d2a1f]",
    "bg-[#3a4d3f]",
    "bg-[#5b4332]",
    "bg-[#2f3a4d]",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) & 0xff;
  return palette[hash % palette.length];
}
function initialsFor(name: string | null): string {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
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
      <p className="text-sm text-brand-olive">
        No cards yet. Enrol a customer into a program using the form on the right.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by customer or program…"
        className="block w-full rounded-lg border border-brand-green/10 bg-brand-cream/40 px-3 py-2 text-sm text-brand-green placeholder:text-brand-olive/70 focus:outline-none focus:border-brand-green/30"
      />
      {filtered.length === 0 ? (
        <p className="text-sm text-brand-olive">No matches.</p>
      ) : (
        <ul className="divide-y divide-brand-green/10">
          {filtered.map((c) => {
            const isPoints = c.programType === "points";
            const state = c.cardState as
              | {
                  stamps_current?: number;
                  points_current?: number;
                  rewards_redeemed?: number;
                }
              | null;
            const cur = isPoints
              ? state?.points_current ?? 0
              : state?.stamps_current ?? 0;
            const target = isPoints ? c.pointsForReward ?? 0 : c.stampsRequired;
            const eligible = target > 0 && cur >= target;
            const expired = c.status === "expired";
            const s = stampState[c.id] ?? { busy: false, err: null };
            const name = c.customerName ?? "(no name)";
            return (
              <li key={c.id} className={"py-3 " + (expired ? "opacity-60" : "")}>
                <div className="flex items-center gap-3">
                  <div
                    className={
                      "h-9 w-9 rounded-md text-white text-xs font-medium flex items-center justify-center shrink-0 " +
                      avatarColorFor(name)
                    }
                  >
                    {initialsFor(c.customerName)}
                  </div>
                  <Link
                    href={`/dashboard/cards/${c.id}`}
                    className="flex-1 min-w-0 hover:underline underline-offset-4"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-brand-green truncate">{name}</span>
                      {expired ? (
                        <span className="rounded-full bg-brand-olive/20 px-2 py-0.5 text-xs text-brand-olive">
                          Expired
                        </span>
                      ) : null}
                      {isPoints ? (
                        <span className="rounded-full bg-brand-gold/15 px-2 py-0.5 text-xs text-brand-green">
                          Points
                        </span>
                      ) : null}
                    </div>
                    <div className="text-xs text-brand-olive mt-0.5 truncate">
                      {c.programName}
                    </div>
                  </Link>
                  <div className="text-right shrink-0 mr-2 hidden sm:block">
                    <div className="font-serif text-xl text-brand-green tabular-nums">
                      {cur}
                      <span className="text-brand-olive/70">/{target}</span>
                    </div>
                    <div className="text-[10px] uppercase tracking-wide text-brand-olive">
                      {state?.rewards_redeemed ?? 0} redeemed
                    </div>
                  </div>
                  {isPoints ? (
                    <Link
                      href={`/dashboard/cards/${c.id}`}
                      className="rounded-full border border-brand-green/15 px-3 py-1.5 text-xs font-medium text-brand-green hover:bg-brand-cream shrink-0"
                    >
                      Open
                    </Link>
                  ) : (
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
                      className="rounded-full bg-brand-green px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-green-deep disabled:opacity-40 shrink-0 transition-colors"
                    >
                      {s.busy ? "…" : "+1 stamp"}
                    </button>
                  )}
                </div>
                {s.err ? (
                  <p className="mt-2 ml-12 text-xs text-red-700">{s.err}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
