"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AboutBadge } from "@/components/AboutBadge";

export type NavDestination = { href: string; label: string };

function isActive(pathname: string, href: string): boolean {
  // "/" would otherwise match every route, and /consent must stay lit on /consent/<site>.
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** This app's own nav row, under the Barrel Labs utility bar.
 *
 * It carries destinations and actions only. Identity — who you are signed in as, your role and
 * clearance, and the way out — belongs to the Labs bar above it and used to be duplicated here;
 * two avatars and two sign-outs within 15px of each other was the cost of the bars being separate.
 * The brand went the same way: the Labs lockup already reads BARREL LABS / SITE AUDIT, and
 * "Reports" is the destination the wordmark linked to anyway.
 *
 * Split from TopNav so the server can decide which destinations this person is allowed to see
 * before any of them reach the browser. */
export function TopNavBar({ destinations }: { destinations: NavDestination[] }) {
  const pathname = usePathname() ?? "/";

  return (
    <header className="bg-white border-b border-[#E5E5E5] print:hidden">
      <div className="max-w-[1600px] mx-auto px-6 lg:px-8 h-[56px] flex items-center gap-6">
        <nav className="flex items-center gap-1 min-w-0 overflow-x-auto -ml-3" aria-label="Primary">
          {destinations.map((d) => {
            const active = isActive(pathname, d.href);
            return (
              <Link
                key={d.href}
                href={d.href}
                aria-current={active ? "page" : undefined}
                className={`text-sm px-3 py-1.5 rounded-md whitespace-nowrap transition-colors ${
                  active
                    ? "text-[#000000] bg-[#EDECE8] font-medium"
                    : "text-[#6B6B6B] hover:text-[#1A1A1A] hover:bg-[#f0efed]"
                }`}
              >
                {d.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-3 ml-auto shrink-0">
          <Link
            href="/run"
            className="text-sm font-semibold text-white bg-[#1A1A1A] hover:bg-black px-3.5 py-2 rounded-lg transition-colors"
          >
            + Run Audit
          </Link>
          <AboutBadge />
        </div>
      </div>
    </header>
  );
}
