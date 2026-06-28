"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Icon glyphs are inline SVGs (no external icon library). Matches the
// mockup's minimal stroke style — light line icons aligned with text.
function IconGrid(): JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <rect x="2.5" y="2.5" width="6" height="6" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <rect x="11.5" y="2.5" width="6" height="6" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <rect x="2.5" y="11.5" width="6" height="6" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <rect x="11.5" y="11.5" width="6" height="6" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
function IconUsers(): JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <circle cx="8" cy="7" r="3" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2 17c0-3 2.7-5 6-5s6 2 6 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="15" cy="6" r="2.2" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
function IconCard(): JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <rect x="2" y="5" width="16" height="11" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2 9h16" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
function IconMegaphone(): JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path d="M3 8v4l11 4V4L3 8z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M14 7v6c1.5 0 3-1.3 3-3s-1.5-3-3-3z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}
function IconBars(): JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path d="M3 16h14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <rect x="4" y="9" width="2.5" height="5" rx="0.6" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9" y="6" width="2.5" height="8" rx="0.6" stroke="currentColor" strokeWidth="1.4" />
      <rect x="14" y="11" width="2.5" height="3" rx="0.6" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
function IconScan(): JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path d="M3 7V4h3M14 4h3v3M17 13v3h-3M6 17H3v-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
function IconTeam(): JSX.Element {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <circle cx="6.5" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="13.5" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2 16c.5-2.2 2.4-3.5 4.5-3.5s4 1.3 4.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M11 16c.5-2.2 2.4-3.5 4.5-3.5s4 1.3 4.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

interface Tab {
  href: string;
  label: string;
  icon: () => JSX.Element;
}

const TABS: Tab[] = [
  { href: "/dashboard", label: "Overview", icon: IconGrid },
  { href: "/dashboard/customers", label: "Customers", icon: IconUsers },
  { href: "/dashboard/cards", label: "Cards", icon: IconCard },
  { href: "/dashboard/card-builder", label: "Card builder", icon: IconCard },
  { href: "/dashboard/messages", label: "Campaigns", icon: IconMegaphone },
  { href: "/dashboard/analytics", label: "Analytics", icon: IconBars },
  { href: "/dashboard/scan", label: "Stamp & scan", icon: IconScan },
  { href: "/dashboard/team", label: "Team", icon: IconTeam },
];

export function DashboardNav(): JSX.Element {
  const pathname = usePathname();
  return (
    <nav className="space-y-1">
      {TABS.map((t) => {
        const Icon = t.icon;
        const active =
          t.href === "/dashboard"
            ? pathname === "/dashboard"
            : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors " +
              (active
                ? "bg-white/10 text-white font-medium"
                : "text-white/70 hover:text-white hover:bg-white/5")
            }
          >
            <Icon />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
