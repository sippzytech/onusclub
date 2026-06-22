"use client";

import { useMemo, useState } from "react";
import type { Customer } from "@onusclub/shared";

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
    return <p className="text-sm text-gray-600">No customers yet. Add your first one below.</p>;
  }

  return (
    <div className="space-y-3">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name, phone or email…"
        className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
      />
      {filtered.length === 0 ? (
        <p className="text-sm text-gray-600">No matches.</p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((c) => (
            <li
              key={c.id}
              className="rounded-md border border-gray-200 bg-white p-4 text-sm"
            >
              <div className="font-medium text-gray-900">{c.name ?? "(no name)"}</div>
              <div className="text-gray-600 mt-1">
                {[c.phone, c.email].filter(Boolean).join(" · ") || "—"}
                {c.birthday ? <span className="text-gray-400"> · 🎂 {c.birthday}</span> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
