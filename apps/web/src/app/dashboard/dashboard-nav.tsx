"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/dashboard", label: "Programs" },
  { href: "/dashboard/customers", label: "Customers" },
  { href: "/dashboard/cards", label: "Cards" },
];

export function DashboardNav(): JSX.Element {
  const pathname = usePathname();
  return (
    <nav className="flex gap-6 -mb-px">
      {TABS.map((t) => {
        const active =
          t.href === "/dashboard"
            ? pathname === "/dashboard"
            : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={
              "py-3 text-sm border-b-2 " +
              (active
                ? "border-gray-900 text-gray-900 font-medium"
                : "border-transparent text-gray-500 hover:text-gray-800")
            }
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
