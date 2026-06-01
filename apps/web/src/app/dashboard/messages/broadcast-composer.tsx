"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { Program } from "@stampdeck/shared";

export function BroadcastComposer(): JSX.Element {
  const router = useRouter();
  const [header, setHeader] = useState("");
  const [body, setBody] = useState("");
  const [filterMode, setFilterMode] = useState<"all" | "filtered">("all");
  const [minStamps, setMinStamps] = useState<string>("");
  const [withBirthdayThisMonth, setWithBirthdayThisMonth] = useState(false);
  const [programId, setProgramId] = useState<string>("");
  const [programs, setPrograms] = useState<Program[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const programsLoaded = useRef(false);

  // Lazy-load programs only when the filtered mode is opened.
  useEffect(() => {
    if (filterMode !== "filtered" || programsLoaded.current) return;
    programsLoaded.current = true;
    fetch("/api/programs-list")
      .then((r) => (r.ok ? r.json() : { programs: [] }))
      .then((data: { programs: Program[] }) => setPrograms(data.programs ?? []))
      .catch(() => undefined);
  }, [filterMode]);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setPending(true);
    setError(null);
    const audienceFilter =
      filterMode === "all"
        ? undefined
        : {
            ...(minStamps.trim() !== ""
              ? { minLifetimeStamps: Number(minStamps) }
              : {}),
            ...(withBirthdayThisMonth ? { withBirthdayThisMonth: true } : {}),
            ...(programId !== "" ? { programId } : {}),
          };
    const res = await fetch("/api/broadcasts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ header, body, audienceFilter }),
    });
    setPending(false);
    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as { error?: string };
      setError(errBody.error ?? "failed to start broadcast");
      return;
    }
    setHeader("");
    setBody("");
    setMinStamps("");
    setWithBirthdayThisMonth(false);
    setProgramId("");
    setFilterMode("all");
    router.refresh();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3 rounded-md border border-gray-200 bg-white p-4"
    >
      <div>
        <label className="block text-sm font-medium text-gray-800">
          Notification title
          <span className="ml-2 text-xs text-gray-400">{header.length}/60</span>
        </label>
        <input
          required
          value={header}
          maxLength={60}
          onChange={(e) => setHeader(e.target.value)}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          placeholder="Friday special: 20% off all drinks"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-800">
          Message body
          <span className="ml-2 text-xs text-gray-400">{body.length}/200</span>
        </label>
        <textarea
          required
          value={body}
          maxLength={200}
          rows={3}
          onChange={(e) => setBody(e.target.value)}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          placeholder="Show your loyalty card and we'll knock 20% off any drink this Friday."
        />
      </div>

      <fieldset className="border-t border-gray-100 pt-3">
        <legend className="text-sm font-medium text-gray-800">Audience</legend>
        <div className="mt-2 space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={filterMode === "all"}
              onChange={() => setFilterMode("all")}
            />
            All active customers
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={filterMode === "filtered"}
              onChange={() => setFilterMode("filtered")}
            />
            Only customers who match…
          </label>
        </div>
        {filterMode === "filtered" ? (
          <div className="mt-3 space-y-3 pl-6 border-l border-gray-100 ml-1">
            <div>
              <label className="block text-xs font-medium text-gray-700">
                Have collected at least N lifetime stamps
              </label>
              <input
                type="number"
                min={0}
                value={minStamps}
                onChange={(e) => setMinStamps(e.target.value)}
                placeholder="e.g. 5 — leave blank for no minimum"
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-800">
              <input
                type="checkbox"
                checked={withBirthdayThisMonth}
                onChange={(e) => setWithBirthdayThisMonth(e.target.checked)}
              />
              Have a birthday this month
            </label>
            <div>
              <label className="block text-xs font-medium text-gray-700">
                Only customers on a specific program
              </label>
              <select
                value={programId}
                onChange={(e) => setProgramId(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">— any program —</option>
                {programs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-xs text-gray-500">
              Filters combine with AND. If you leave them all blank this is the
              same as sending to all active customers.
            </p>
          </div>
        ) : null}
      </fieldset>

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
        {pending ? "Starting…" : "Send broadcast"}
      </button>
      <p className="text-xs text-gray-500">
        Customers can mute notifications from a specific business inside Google
        Wallet at any time.
      </p>
    </form>
  );
}
