"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface Tab {
  href: string;
  label: string;
}

// A separate list from DashboardNav's TABS rather than a conditional branch
// inside it. That constant is a module-level array rendered for every café on
// the platform, so admin entries there would exist in every merchant's bundle
// behind a flag — the sort of thing that is one refactor away from leaking.
const TABS: Tab[] = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/merchants", label: "Cafés" },
  { href: "/admin/customers", label: "Find a customer" },
];

export function AdminNav(): JSX.Element {
  const pathname = usePathname();
  return (
    <nav className="space-y-1">
      {TABS.map((t) => {
        const active = t.href === "/admin" ? pathname === "/admin" : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={
              "block rounded-lg px-3 py-2.5 text-sm transition-colors " +
              (active
                ? "bg-white/15 text-white font-medium"
                : "text-white/60 hover:text-white hover:bg-white/5")
            }
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
