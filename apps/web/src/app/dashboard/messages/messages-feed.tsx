"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { MessageFeedItem } from "@stampdeck/shared";

const POLL_INTERVAL_MS = 2500;

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function percent(item: MessageFeedItem): number {
  const total = item.scanned;
  if (total === 0) return item.status === "running" ? 0 : 100;
  const done = item.sent + item.failed;
  return Math.min(100, Math.round((done / total) * 100));
}

function StatusBadge({ item }: { item: MessageFeedItem }): JSX.Element {
  if (item.status === "running") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800">
        <span className="h-1.5 w-1.5 rounded-full bg-blue-600 animate-pulse" />
        Sending
      </span>
    );
  }
  if (item.status === "failed") {
    return (
      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800">
        Crashed
      </span>
    );
  }
  if (item.failed > 0) {
    return (
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
        Done · {item.failed} failed
      </span>
    );
  }
  return (
    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
      Done
    </span>
  );
}

function iconFor(item: MessageFeedItem): string {
  if (item.kind === "broadcast") return "📢";
  if (item.sweepType === "birthday") return "🎂";
  return "⏰";
}

function detailHref(item: MessageFeedItem): string {
  return item.kind === "broadcast"
    ? `/dashboard/messages/broadcast/${item.id}`
    : `/dashboard/messages/sweep/${item.id}`;
}

export function MessagesFeed({
  initialItems,
}: {
  initialItems: MessageFeedItem[];
}): JSX.Element {
  const [items, setItems] = useState<MessageFeedItem[]>(initialItems);
  const hasRunning = items.some((i) => i.status === "running");

  // Poll while anything is still running. As soon as everything settles,
  // back off — saves the api a steady drip of requests when nothing's
  // happening.
  useEffect(() => {
    if (!hasRunning) return;
    const t = setInterval(async () => {
      try {
        const res = await fetch("/api/messages-feed", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { items: MessageFeedItem[] };
        setItems(data.items);
      } catch {
        // ignore transient
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [hasRunning]);

  if (items.length === 0) {
    return (
      <p className="text-sm text-gray-600">
        No broadcasts or sweeps yet. Send your first one above.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {items.map((item) => {
        const pct = percent(item);
        return (
          <li
            key={`${item.kind}-${item.id}`}
            className="rounded-md border border-gray-200 bg-white p-4 text-sm"
          >
            <Link href={detailHref(item)} className="block hover:bg-gray-50 -m-4 p-4 rounded-md">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span aria-hidden>{iconFor(item)}</span>
                    <span className="font-medium text-gray-900 truncate">
                      {item.header}
                    </span>
                    <StatusBadge item={item} />
                  </div>
                  {item.body ? (
                    <p className="text-gray-600 mt-1 line-clamp-1">{item.body}</p>
                  ) : null}
                  <p className="text-xs text-gray-500 mt-2 tabular-nums">
                    {relativeTime(item.startedAt)} · {item.sent} sent ·{" "}
                    {item.failed} failed · {item.scanned} total
                  </p>
                </div>
              </div>
              {item.status === "running" ? (
                <div className="mt-3">
                  <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                    <div
                      className="h-2 bg-blue-500 transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1 tabular-nums">{pct}%</p>
                </div>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
