import type { MessageFeedItem } from "@onusclub/shared";
import { apiFetch } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { DashboardShell } from "../dashboard-shell";
import { AutomationToggle } from "./automation-toggle";
import { BroadcastComposer } from "./broadcast-composer";
import { MessagesFeed } from "./messages-feed";
import { PremiumLock } from "./premium-lock";
import { SweepTriggers } from "./sweep-triggers";

export const dynamic = "force-dynamic";

export default async function MessagesPage(): Promise<JSX.Element> {
  const { jwt, user, merchant, preferences } = await requireSession();

  // Non-premium merchants see the lock screen. UI gate only — the api also
  // returns 402 on broadcast send so this can't be bypassed by calling the
  // endpoint directly.
  if (!preferences.isPremium) {
    return (
      <DashboardShell user={user} merchant={merchant}>
        <PremiumLock />
      </DashboardShell>
    );
  }

  const { items } = await apiFetch<{ items: MessageFeedItem[] }>("/v1/messages", { jwt });

  return (
    <DashboardShell user={user} merchant={merchant}>
      <div className="space-y-10">
        <AutomationToggle cronsEnabled={preferences.cronsEnabled} />

        <section className="space-y-3">
          <h2 className="text-lg font-medium text-gray-900">Send a broadcast</h2>
          <p className="text-sm text-gray-600">
            Pushes a message + notification to every active customer&apos;s pass.
            Sends in the background — you can leave this page and check back later.
          </p>
          <BroadcastComposer />
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-medium text-gray-900">Activity</h2>
          <p className="text-sm text-gray-600">
            Live progress for in-flight broadcasts. History of every broadcast and
            cron sweep that touched your customers. Click into any row for per-card
            delivery status + retry.
          </p>
          <MessagesFeed initialItems={items} />
        </section>

        <section className="space-y-3 pt-4 border-t border-gray-100">
          <h2 className="text-sm font-medium text-gray-700">Manual sweep triggers (dev)</h2>
          <p className="text-xs text-gray-500">
            Daily cron normally runs these at 08:00 (birthday) and 10:00 (inactivity)
            Europe/Amsterdam. Use these buttons to test on demand.
          </p>
          <SweepTriggers />
        </section>
      </div>
    </DashboardShell>
  );
}
