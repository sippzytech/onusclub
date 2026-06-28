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

  if (!preferences.isPremium) {
    return (
      <DashboardShell
        user={user}
        merchant={merchant}
        isPremium={preferences.isPremium}
        breadcrumb={`${merchant.businessName} · Messaging`}
        title="Campaigns"
      >
        <PremiumLock />
      </DashboardShell>
    );
  }

  const { items } = await apiFetch<{ items: MessageFeedItem[] }>("/v1/messages", { jwt });

  return (
    <DashboardShell
      user={user}
      merchant={merchant}
      isPremium={preferences.isPremium}
      breadcrumb={`${merchant.businessName} · Messaging`}
      title="Campaigns"
    >
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Main column: composer + activity feed */}
        <div className="xl:col-span-2 space-y-4">
          <div className="rounded-card bg-white border border-brand-green/10 p-6">
            <AutomationToggle cronsEnabled={preferences.cronsEnabled} />
          </div>

          <div className="rounded-card bg-white border border-brand-green/10 p-6">
            <h2 className="font-serif text-2xl text-brand-green">Send a broadcast</h2>
            <p className="text-sm text-brand-olive mt-1">
              Push a message + notification to every active customer&apos;s pass.
              Sends in the background — you can leave this page and check back later.
            </p>
            <div className="mt-4">
              <BroadcastComposer />
            </div>
          </div>

          <div className="rounded-card bg-white border border-brand-green/10 p-6">
            <h2 className="font-serif text-2xl text-brand-green">Activity</h2>
            <p className="text-sm text-brand-olive mt-1">
              Live progress for in-flight broadcasts. History of every broadcast and
              cron sweep that touched your customers. Click into any row for per-card
              delivery status + retry.
            </p>
            <div className="mt-4">
              <MessagesFeed initialItems={items} />
            </div>
          </div>
        </div>

        {/* Side column: push preview + dev triggers */}
        <div className="space-y-4">
          <div className="rounded-card bg-white border border-brand-green/10 p-6">
            <div className="flex items-start justify-between">
              <h2 className="font-serif text-2xl text-brand-green">Push preview</h2>
              <span className="text-xs text-brand-olive">iPhone lock screen</span>
            </div>
            {/* Phone-shaped lock-screen mockup */}
            <div className="mt-5 mx-auto w-64 rounded-3xl bg-brand-green-deepest p-4 text-white shadow-lg">
              <p className="font-serif text-3xl text-center">9:41</p>
              <p className="text-center text-xs text-white/60">Saturday, 21 June</p>
              <div className="mt-4 rounded-xl bg-white/10 p-3 flex items-start gap-2">
                <div className="h-8 w-8 rounded-md bg-brand-gold flex items-center justify-center shrink-0">
                  <span className="text-sm">🎁</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-xs font-medium">{merchant.businessName}</p>
                    <p className="text-[10px] text-white/50">now</p>
                  </div>
                  <p className="text-xs text-white/80 mt-0.5 line-clamp-2">
                    Your loyalty pass has a new message — open Wallet to see it.
                  </p>
                </div>
              </div>
            </div>
            <p className="text-xs text-brand-olive mt-4">
              Your real broadcast copy renders here when you send. Customers see
              this on lock screen even when their phone is asleep.
            </p>
          </div>

          <div className="rounded-card border border-dashed border-brand-green/20 bg-brand-cream/50 p-5">
            <h3 className="text-sm font-medium text-brand-green">
              Manual sweep triggers (dev)
            </h3>
            <p className="text-xs text-brand-olive mt-1">
              Daily cron normally runs at 08:00 (birthday) and 10:00 (inactivity)
              Europe/Amsterdam. Trigger on demand:
            </p>
            <div className="mt-3">
              <SweepTriggers />
            </div>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
