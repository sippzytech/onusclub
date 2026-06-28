import Link from "next/link";
import type { ReactNode } from "react";
import type { Merchant, SessionUser } from "@onusclub/shared";
import { DashboardNav } from "./dashboard-nav";
import { LogoutButton } from "./logout-button";

interface Props {
  user: SessionUser;
  merchant: Merchant;
  // Per-page header bits. If omitted, no breadcrumb/title is rendered and
  // the page is expected to render its own.
  breadcrumb?: string;
  title?: string;
  // Plan tag in the sidebar card. Optional — defaults to free tier copy.
  isPremium?: boolean;
  children: ReactNode;
}

export function DashboardShell({
  user,
  merchant,
  breadcrumb,
  title,
  isPremium = false,
  children,
}: Props): JSX.Element {
  const initials = (merchant.businessName ?? "OC")
    .split(/\s+/)
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div className="min-h-screen bg-brand-cream flex">
      {/* Sidebar */}
      <aside className="hidden md:flex w-[260px] shrink-0 bg-brand-green text-white flex-col">
        {/* Logo */}
        <div className="px-5 py-5 flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-md bg-brand-gold flex items-center justify-center">
            <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
              <path d="M4 10.5l3.5 3.5 8.5-8.5" stroke="#14271C" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <span className="font-serif text-xl tracking-tight">OnUsClub</span>
        </div>

        {/* Nav */}
        <div className="flex-1 px-3 py-2 overflow-y-auto">
          <DashboardNav />
        </div>

        {/* Plan card */}
        <div className="m-3 p-4 rounded-card bg-white/5 border border-white/10">
          <p className="text-sm font-medium text-white">
            {isPremium ? "Pro plan" : "Free plan"}
          </p>
          <p className="text-xs text-white/60 mt-1 leading-relaxed">
            {isPremium
              ? "Premium features unlocked. Manage your plan anytime."
              : "Unlock campaigns, audience filters, and more."}
          </p>
          <Link
            href="/dashboard/team"
            className="mt-3 block text-center rounded-lg bg-brand-gold py-2 text-sm font-medium text-brand-green hover:bg-brand-gold-light transition-colors"
          >
            {isPremium ? "Manage plan" : "Upgrade"}
          </Link>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="bg-brand-cream border-b border-brand-green/10 px-6 md:px-8 py-5 flex items-start justify-between gap-6">
          <div className="min-w-0">
            {breadcrumb ? (
              <p className="text-xs text-brand-olive tracking-wide">{breadcrumb}</p>
            ) : null}
            {title ? (
              <h1 className="font-serif text-3xl text-brand-green mt-1 truncate">
                {title}
              </h1>
            ) : null}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {/* Search — wired to customers list later */}
            <div className="hidden lg:flex items-center gap-2 rounded-full bg-white border border-brand-green/10 px-4 py-2 w-80">
              <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 text-brand-olive">
                <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.5" />
                <path d="M14 14l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <input
                type="search"
                placeholder="Search members…"
                className="flex-1 bg-transparent text-sm text-brand-green placeholder:text-brand-olive/70 focus:outline-none"
              />
            </div>
            {/* Merchant switcher (placeholder — single-merchant today) */}
            <button
              type="button"
              className="flex items-center gap-2 rounded-full bg-white border border-brand-green/10 pl-2 pr-3 py-1.5 text-sm text-brand-green"
              title={user.email}
            >
              <span className="h-7 w-7 rounded-md bg-brand-green text-white text-xs font-medium flex items-center justify-center">
                {initials}
              </span>
              <span className="font-medium hidden sm:inline">{merchant.businessName}</span>
              <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 text-brand-olive">
                <path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <LogoutButton />
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 px-6 md:px-8 pb-10">{children}</main>
      </div>
    </div>
  );
}
