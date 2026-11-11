"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Customer } from "@onusclub/shared";

// Stable per-name avatar colour. Same palette as the Overview activity feed.
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

function formatJoined(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export function CustomersList({ customers }: { customers: Customer[] }): JSX.Element {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Remove: deletes the customer and cascades their cards and history. They
   * can sign up again from zero — that is the difference from a block, and
   * the confirm says so, because the two are easy to muddle at a till.
   */
  async function remove(c: Customer): Promise<void> {
    const name = c.name ?? "this customer";
    if (
      !window.confirm(
        `Remove ${name}?\n\nTheir card, stamps and history are deleted. ` +
          `They can sign up again from scratch.`
      )
    ) {
      return;
    }
    setError(null);
    setBusyId(c.id);
    const res = await fetch(`/api/customers/${c.id}`, { method: "DELETE" });
    setBusyId(null);
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      setError(b.error ?? "could not remove this customer");
      return;
    }
    router.refresh();
  }

  /**
   * Block: stops them signing up again AND blocks the card they hold.
   *
   * The reason is required by the API, so it is prompted for rather than
   * optional — a block nobody can review later is one nobody can safely lift.
   */
  async function block(c: Customer): Promise<void> {
    const name = c.name ?? "this customer";
    if (!c.email && !c.phone) {
      setError(
        `${name} has no email or phone, so there is nothing to block them by. Remove them instead.`
      );
      return;
    }
    const reason = window.prompt(
      `Block ${name}?\n\nTheir card stops working and they cannot sign up here again.\n\n` +
        `Why are you blocking them? (recorded, and shown if you lift it later)`
    );
    if (reason === null) return;
    if (reason.trim().length < 3) {
      setError("Please give a reason of at least a few words.");
      return;
    }
    setError(null);
    setBusyId(c.id);
    const res = await fetch(`/api/customers/${c.id}/block`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: reason.trim() }),
    });
    setBusyId(null);
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      setError(b.error ?? "could not block this customer");
      return;
    }
    router.refresh();
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) =>
      [c.name, c.phone, c.email]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(q))
    );
  }, [customers, query]);

  if (customers.length === 0) {
    return (
      <p className="text-sm text-brand-olive">
        No customers yet. Add your first one with the form on the right.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name, phone or email…"
        className="block w-full rounded-lg border border-brand-green/10 bg-brand-cream/40 px-3 py-2 text-sm text-brand-green placeholder:text-brand-olive/70 focus:outline-none focus:border-brand-green/30"
      />
      {filtered.length === 0 ? (
        <p className="text-sm text-brand-olive">No matches.</p>
      ) : (
        <div className="overflow-x-auto -mx-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-brand-olive">
                <th className="px-2 py-2 font-medium">Member</th>
                <th className="px-2 py-2 font-medium">Joined</th>
                <th className="px-2 py-2 font-medium">Contact</th>
                <th className="px-2 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-green/10">
              {filtered.map((c) => {
                const name = c.name ?? "(no name)";
                return (
                  <tr key={c.id} className="hover:bg-brand-cream/40 transition-colors">
                    <td className="px-2 py-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={
                            "h-9 w-9 rounded-md text-white text-xs font-medium flex items-center justify-center shrink-0 " +
                            avatarColorFor(name)
                          }
                        >
                          {initialsFor(c.name)}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-brand-green truncate">{name}</p>
                          {c.email ? (
                            <p className="text-xs text-brand-olive truncate">{c.email}</p>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-3 text-brand-olive whitespace-nowrap">
                      {formatJoined(c.createdAt)}
                    </td>
                    <td className="px-2 py-3 text-brand-olive">
                      {c.phone ?? "—"}
                      {c.birthday ? (
                        <span className="ml-2 text-brand-gold">🎂 {c.birthday.slice(5)}</span>
                      ) : null}
                    </td>
                    <td className="px-2 py-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        disabled={busyId === c.id}
                        onClick={() => void remove(c)}
                        className="text-xs text-brand-olive hover:text-brand-green underline-offset-4 hover:underline disabled:opacity-50"
                      >
                        Remove
                      </button>
                      <button
                        type="button"
                        disabled={busyId === c.id}
                        onClick={() => void block(c)}
                        className="ml-3 text-xs text-red-700 hover:text-red-900 underline-offset-4 hover:underline disabled:opacity-50"
                      >
                        Block
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
