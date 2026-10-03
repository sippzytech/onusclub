import Link from "next/link";
import type { ReactNode } from "react";
import type { AdminWhoami } from "@onusclub/shared";
import { AdminNav } from "./admin-nav";

/**
 * Chrome for the platform-admin surface.
 *
 * A sibling of DashboardShell, not a variant of it. That component takes a
 * `merchant` and renders a trial banner and a plan card — all of which are
 * meaningless here, since this view belongs to no café. More importantly it is
 * visually different on purpose: near-black rather than brand green, with the
 * environment named in the sidebar. Someone who can adjust any customer's
 * balance on any café's account should never be in doubt about which screen
 * they are looking at.
 */
export function AdminShell({
  admin,
  breadcrumb,
  title,
  actions,
  children,
}: {
  admin: AdminWhoami;
  breadcrumb?: ReactNode;
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="min-h-screen bg-slate-100 flex">
      <aside className="hidden md:flex w-[220px] shrink-0 bg-slate-900 text-white flex-col">
        <div className="px-5 py-5">
          <p className="font-serif text-lg tracking-tight">OnUsClub</p>
          <p className="text-[11px] uppercase tracking-widest text-amber-400 mt-0.5">
            Platform admin
          </p>
        </div>

        <div className="flex-1 px-3 py-2">
          <AdminNav />
        </div>

        <div className="m-3 p-3 rounded-lg bg-white/5 border border-white/10">
          <p className="text-[11px] text-white/50 uppercase tracking-wider">Signed in as</p>
          <p className="text-xs text-white/80 mt-1 break-all">{admin.email}</p>
          <Link
            href="/dashboard"
            className="mt-3 block text-center rounded-lg border border-white/20 py-1.5 text-xs text-white/80 hover:bg-white/10 transition-colors"
          >
            Back to my café
          </Link>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-white border-b border-slate-200 px-6 md:px-8 py-5 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            {breadcrumb ? (
              <p className="text-xs text-slate-500 tracking-wide">{breadcrumb}</p>
            ) : null}
            <h1 className="font-serif text-2xl text-slate-900 mt-1">{title}</h1>
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </header>

        <main className="flex-1 px-6 md:px-8 py-6">{children}</main>
      </div>
    </div>
  );
}
