import { LABS_URL } from "@/lib/labs-auth";
import { getLabsSession } from "@/lib/labs-session";
import { LabsNav } from "@/components/labs-nav";
import { TopNavBar, type NavDestination } from "@/components/TopNavBar";

/** The app's primary navigation.
 *
 * Two bars, with different owners. The top one is the Barrel Labs utility nav — identical in every
 * Labs app, carrying who you are signed in as, the switcher to the other Barrel tools you are
 * cleared for, and EJECT. Nothing app-specific belongs in it; the value is that someone moving
 * between four Barrel tools never has to hunt for their own account or the way out.
 *
 * The second bar is this app's own: the brand, the destinations, and Run Audit. Every page used to
 * carry its own header with an ad-hoc list of links, which meant each new surface either got
 * forgotten or made the row longer until the actions at the end were the first thing to wrap. One
 * definition, one place to add the next destination.
 *
 * This is a server component so the row can be built from the signed-in person's Barrel Labs role.
 * A destination they cannot open is left out rather than rendered and then refused — the refusal
 * still exists (in middleware and in the page itself), this just avoids advertising a dead end.
 *
 * Both bars are hidden in print: a report saved as a PDF is a document, not a screenshot of the
 * tool that made it. */
const DESTINATIONS: Array<NavDestination & { adminOnly?: boolean }> = [
  { href: "/", label: "Reports" },
  { href: "/cro", label: "CRO Audits" },
  { href: "/consent", label: "Privacy Compliance", adminOnly: true },
  { href: "/progress", label: "Baseline & Reporting" },
  { href: "/repos", label: "Theme Repos" },
  { href: "/instructions", label: "CLI Instructions" },
];

export async function TopNav() {
  const session = await getLabsSession();
  const admin = session?.role === "admin";

  return (
    <>
      {/* Rendered here rather than in the root layout on purpose: /share/<token> client reports are
          public by design and must inherit no Barrel chrome and no staff name. They are the pages
          that don't call TopNav. */}
      {session && (
        <div className="print:hidden">
          <LabsNav
            session={session}
            appName="Site Audit"
            labsUrl={LABS_URL}
            currentSlug={process.env.LABS_APP_SLUG}
            // This app's sign-out predates the template's route name and drops the same cookie.
            signOutPath="/api/logout"
          />
        </div>
      )}
      <TopNavBar
        destinations={DESTINATIONS.filter((d) => !d.adminOnly || admin).map(({ href, label }) => ({ href, label }))}
      />
    </>
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
