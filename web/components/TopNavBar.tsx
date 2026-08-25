"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AboutBadge } from "@/components/AboutBadge";

export type NavDestination = { href: string; label: string };

export type NavUser = { email: string; name: string | null; picture: string | null; admin: boolean };

function isActive(pathname: string, href: string): boolean {
  // "/" would otherwise match every route, and /consent must stay lit on /consent/<site>.
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function initials(user: NavUser): string {
  const source = user.name?.trim() || user.email;
  const parts = source.split(/[\s.@_-]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").toUpperCase() + (parts[1]?.[0]?.toUpperCase() ?? "");
}

/** The interactive half of the nav. Split from TopNav so the server can decide which destinations
 * this person is allowed to see before any of them reach the browser. */
export function TopNavBar({ destinations, user }: { destinations: NavDestination[]; user: NavUser | null }) {
  const pathname = usePathname() ?? "/";

  return (
    <header className="bg-white border-b border-[#E5E5E5] print:hidden">
      <div className="max-w-[1600px] mx-auto px-6 lg:px-8 h-[73px] flex items-center gap-6">
        <Link href="/" className="text-2xl font-semibold text-[#1A1A1A] tracking-tight shrink-0 hover:text-[#000000]">
          Barrel Site Audit
        </Link>

        <nav className="flex items-center gap-1 min-w-0 overflow-x-auto" aria-label="Primary">
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
          {user && (
            // Who you are signed in as matters more here than it does in a password-protected app:
            // the page you can see depends on it, so a member wondering where Privacy Compliance
            // went can read the answer off the header rather than assume the link is broken.
            <span
              className="flex items-center gap-2 min-w-0"
              title={user.admin ? `${user.email} — Barrel Labs admin` : user.email}
            >
              {user.picture ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={user.picture}
                  alt=""
                  width={28}
                  height={28}
                  className="w-7 h-7 rounded-full border border-[#E5E5E5] object-cover"
                />
              ) : (
                <span className="w-7 h-7 rounded-full bg-[#EDECE8] text-[10px] font-semibold text-[#6B6B6B] flex items-center justify-center">
                  {initials(user)}
                </span>
              )}
              {user.admin && (
                <span className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider hidden lg:inline">
                  Admin
                </span>
              )}
            </span>
          )}
          <form action="/api/logout" method="POST">
            <button type="submit" className="text-sm text-[#6B6B6B] hover:text-[#1A1A1A]">
              Sign out
            </button>
          </form>
          <AboutBadge />
        </div>
      </div>
    </header>
  );
}
