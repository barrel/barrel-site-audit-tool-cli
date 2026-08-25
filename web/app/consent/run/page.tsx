import Link from "next/link";
import { AdminsOnlyScreen } from "@/components/AdminsOnly";
import { isLabsAdmin } from "@/lib/labs-session";
import { PageTitle, TopNav } from "@/components/TopNav";
import { BulkConsentForm } from "@/components/BulkConsentForm";

export const dynamic = "force-dynamic";

export default async function BulkConsentRunPage() {
  // Belt as well as braces: middleware already rewrites this route for a non-admin, but a
  // Privacy Compliance page must not depend on the matcher staying correct to stay closed.
  if (!(await isLabsAdmin())) return <AdminsOnlyScreen what="Privacy Compliance" />;

  // Bulk scanning drives a real headless Chrome, which only exists on the machine running
  // `pnpm dev`. Rather than render a button whose only possible outcome on the deployed site is
  // an error, the form becomes a command builder there — you still paste the list, you just get
  // a command to run instead of a run.
  const local = !process.env.VERCEL;

  return (
    <div className="min-h-screen bg-[#f9f8f6]">
      <TopNav />
      <PageTitle title="Bulk privacy scan" />

      <main className="max-w-[1100px] mx-auto px-6 lg:px-8 py-8 space-y-5">
        <p className="text-sm text-[#6B6B6B] max-w-[80ch] leading-relaxed">
          Scans any set of sites for consent behaviour, independently of the per-store audit. Each site is driven
          through five browser states — no choice, reject, accept, analytics-only and returning visitor — in its own
          fresh incognito browser. Results publish to the{" "}
          <Link href="/consent" className="text-[#1A1A1A] font-medium hover:underline">
            Privacy Compliance
          </Link>{" "}
          dashboard the moment the scan finishes, and every site gets its own printable report.
        </p>

        <BulkConsentForm local={local} />

        <p className="text-xs text-[#9A9A9A] max-w-[80ch] leading-relaxed">
          Sites are scanned concurrently; raising concurrency past what the machine can comfortably run means several
          headless Chromes competing for the same cores, which makes every site slower rather than the batch faster.
          Results publish to Blob as soon as the scan finishes, so they appear on the deployed dashboard too — it is
          only the <em>running</em> that has to happen locally.
        </p>
      </main>
    </div>
  );
}
