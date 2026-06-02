"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function CreateProgramForm(): JSX.Element {
  const router = useRouter();
  const [name, setName] = useState("");
  const [stampsRequired, setStampsRequired] = useState(6);
  const [rewardText, setRewardText] = useState("");
  const [expiryDays, setExpiryDays] = useState<string>("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setPending(true);
    setError(null);
    const parsedExpiry = expiryDays.trim() === "" ? undefined : Number(expiryDays);
    const res = await fetch("/api/programs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        stampsRequired,
        rewardText,
        ...(parsedExpiry !== undefined && !Number.isNaN(parsedExpiry)
          ? { expiryDays: parsedExpiry }
          : {}),
      }),
    });
    setPending(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "could not create program");
      return;
    }
    setName("");
    setStampsRequired(6);
    setRewardText("");
    setExpiryDays("");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-md border border-gray-200 bg-white p-4">
      <div>
        <label className="block text-sm font-medium text-gray-800">Program name</label>
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          placeholder="Coffee stamp card"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-800">Stamps required</label>
          <input
            required
            type="number"
            min={1}
            max={100}
            value={stampsRequired}
            onChange={(e) => setStampsRequired(parseInt(e.target.value, 10))}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-800">
            Expiry (optional)
          </label>
          <input
            type="number"
            min={1}
            max={3650}
            value={expiryDays}
            onChange={(e) => setExpiryDays(e.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            placeholder="days of inactivity"
          />
          <p className="mt-1 text-xs text-gray-500">
            Leave blank for cards that never expire.
          </p>
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-800">Reward</label>
        <input
          required
          value={rewardText}
          onChange={(e) => setRewardText(e.target.value)}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          placeholder="A free coffee"
        />
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
        {pending ? "Creating…" : "Create program"}
      </button>
    </form>
  );
}
