"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function BroadcastComposer(): JSX.Element {
  const router = useRouter();
  const [header, setHeader] = useState("");
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await fetch("/api/broadcasts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ header, body }),
    });
    setPending(false);
    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as { error?: string };
      setError(errBody.error ?? "failed to start broadcast");
      return;
    }
    setHeader("");
    setBody("");
    // Refresh the page so the new broadcast row shows up in the feed below.
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
