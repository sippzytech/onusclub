"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RetryButton({ retryPath }: { retryPath: string }): JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onClick(): Promise<void> {
    setPending(true);
    setMsg(null);
    const res = await fetch(retryPath, { method: "POST" });
    setPending(false);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setMsg(`Failed: ${body.error ?? "retry failed"}`);
      return;
    }
    const data = (await res.json()) as { retried: number; sent: number; failed: number };
    setMsg(
      `Retried ${data.retried} · ${data.sent} succeeded · ${data.failed} still failed`
    );
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <button
        onClick={() => void onClick()}
        disabled={pending}
        className="rounded-md border border-gray-300 px-3 py-2 text-xs font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
      >
        {pending ? "Retrying…" : "Retry failed"}
      </button>
      {msg ? <p className="text-xs text-gray-600">{msg}</p> : null}
    </div>
  );
}
