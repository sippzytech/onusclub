"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function SweepTriggers(): JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState<"birthday" | "inactivity" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function fire(type: "birthday" | "inactivity"): Promise<void> {
    setPending(type);
    setMsg(null);
    const res = await fetch(`/api/sweeps/run/${type}`, { method: "POST" });
    setPending(null);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setMsg(`Failed: ${body.error ?? "sweep failed"}`);
      return;
    }
    const data = (await res.json()) as { scanned: number; sent: number; failed: number };
    setMsg(
      `${type[0].toUpperCase() + type.slice(1)} sweep done · ` +
        `${data.scanned} scanned · ${data.sent} sent · ${data.failed} failed`
    );
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button
          onClick={() => void fire("birthday")}
          disabled={pending !== null}
          className="rounded-md border border-gray-300 px-3 py-2 text-xs font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
        >
          {pending === "birthday" ? "Running…" : "🎂 Run birthday sweep"}
        </button>
        <button
          onClick={() => void fire("inactivity")}
          disabled={pending !== null}
          className="rounded-md border border-gray-300 px-3 py-2 text-xs font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
        >
          {pending === "inactivity" ? "Running…" : "⏰ Run inactivity sweep"}
        </button>
      </div>
      {msg ? <p className="text-xs text-gray-600">{msg}</p> : null}
    </div>
  );
}
