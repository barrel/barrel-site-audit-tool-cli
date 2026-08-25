import { getLabsSession } from "@/lib/labs-session";
import { TopNavBar, type NavDestination } from "@/components/TopNavBar";

/** The app's primary navigation.
 *
 * Every page used to carry its own header with an ad-hoc list of links, which meant each new
 * surface either got forgotten or made the row longer until the actions at the end were the first
 * thing to wrap. One definition, one place to add the next destination.
 *
 * The brand stays a plain link to the report list rather than a logo-and-title block: this is an
 * internal tool, and the row is more useful spent on destinations.
 *
 * This is a server component so the row can be built from the signed-in person's Barrel Labs role.
 * A destination they cannot open is left out rather than rendered and then refused — the refusal
 * still exists (in middleware and in the page itself), this just avoids advertising a dead end. */
const DESTINATIONS: Array<NavDestination & { adminOnly?: boolean }> = [
  { href: "/", label: "Reports" },
  { href: "/cro", label: "CRO Audits" },
  { href: "/consent", label: "Privacy Compliance", adminOnly: true },
  { href: "/progress", label: "Baseline & Reporting" },
  { href: "/instructions", label: "CLI Instructions" },
];

export async function TopNav() {
  const session = await getLabsSession();
  const admin = session?.role === "admin";

  return (
    <TopNavBar
      destinations={DESTINATIONS.filter((d) => !d.adminOnly || admin).map(({ href, label }) => ({ href, label }))}
      user={
        session
          ? { email: session.email, name: session.name, picture: session.picture, admin }
          : null
      }
    />
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
