"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AboutBadge } from "@/components/AboutBadge";

/** The app's primary navigation.
 *
 * Every page used to carry its own header with an ad-hoc list of links, which meant each new
 * surface either got forgotten or made the row longer until the actions at the end were the first
 * thing to wrap. One definition, one place to add the next destination.
 *
 * The brand stays a plain link to the report list rather than a logo-and-title block: this is an
 * internal tool, and the row is more useful spent on destinations. */
const DESTINATIONS: Array<{ href: string; label: string }> = [
  { href: "/", label: "Reports" },
  { href: "/consent", label: "Privacy Compliance" },
  { href: "/progress", label: "Baseline & Reporting" },
  { href: "/instructions", label: "CLI Instructions" },
];

function isActive(pathname: string, href: string): boolean {
  // "/" would otherwise match every route, and /consent must stay lit on /consent/<site>.
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function TopNav() {
  const pathname = usePathname() ?? "/";

  return (
    <header className="bg-white border-b border-[#E5E5E5] print:hidden">
      <div className="max-w-[1600px] mx-auto px-6 lg:px-8 h-[73px] flex items-center gap-6">
        <Link href="/" className="text-2xl font-semibold text-[#1A1A1A] tracking-tight shrink-0 hover:text-[#000000]">
          Barrel Site Audit
        </Link>

        <nav className="flex items-center gap-1 min-w-0 overflow-x-auto" aria-label="Primary">
          {DESTINATIONS.map((d) => {
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

/** The title row that sits under the nav on a sub-page.
 *
 * Kept separate so a page's own identity and its actions do not have to compete with the nav for
 * the same 73px — which is what forced the links to wrap once there were more than four. */
export function PageTitle({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="bg-white border-b border-[#E5E5E5] print:hidden">
      <div className="max-w-[1600px] mx-auto px-6 lg:px-8 py-4 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-[#1A1A1A] tracking-tight truncate">{title}</h1>
        {children && <div className="flex items-center gap-3 shrink-0">{children}</div>}
      </div>
    </div>
  );
}
