"use client";

import { useMemo, useState } from "react";
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
  const [query, setQuery] = useState("");

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
