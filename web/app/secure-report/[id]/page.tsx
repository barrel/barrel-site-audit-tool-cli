import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ConsentScanReport } from "@/components/ConsentScanReport";
import { PrintButton } from "@/components/PrintButton";
import { getShare, isLive, secureReportCookieName, verifyUnlockCookie } from "@/lib/consent-share";
import { getConsentScan } from "@/lib/data";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

// A report behind a password has no business in a search index or a link preview.
export const metadata: Metadata = {
  title: "Privacy Compliance report",
  robots: { index: false, follow: false, nocache: true },
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f9f8f6] print:bg-white">
      <header className="bg-white border-b border-[#E5E5E5] px-6 lg:px-8 py-4 print:hidden">
        <span className="text-sm font-semibold text-[#1A1A1A]">Barrel — Privacy Compliance</span>
      </header>
      {children}
    </div>
  );
}

export default async function SecureReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ e?: string }>;
}) {
  const { id } = await params;
  const { e } = await searchParams;
  const record = await getShare(id);

  // One message for missing, revoked and expired: which of the three it is is not the visitor's
  // business, and distinguishing them tells a stranger the link id was real.
  if (!isLive(record)) {
    return (
      <Shell>
        <main className="max-w-[420px] mx-auto px-6 py-16 text-center">
          <h1 className="text-lg font-semibold text-[#1A1A1A]">This link isn&apos;t available</h1>
          <p className="mt-2 text-sm text-[#6B6B6B]">It may have expired or been withdrawn. Ask the person who sent it for a new one.</p>
        </main>
      </Shell>
    );
  }

  const unlocked = verifyUnlockCookie(record, (await cookies()).get(secureReportCookieName(id))?.value);

  if (!unlocked) {
    return (
      <Shell>
        <main className="max-w-[420px] mx-auto px-6 py-16">
          <h1 className="text-lg font-semibold text-[#1A1A1A]">Privacy Compliance report</h1>
          <p className="mt-1 text-sm text-[#6B6B6B]">Enter your email and the password you were given to view this report.</p>
          <form method="POST" action={`/api/secure-report/${id}`} className="mt-5 space-y-3 bg-white border border-[#E5E5E5] rounded-lg p-5">
            <label className="block text-xs font-semibold text-[#1A1A1A]">
              Email
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                className="mt-1 w-full text-sm font-normal border border-[#E5E5E5] rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/10"
              />
            </label>
            <label className="block text-xs font-semibold text-[#1A1A1A]">
              Password
              <input
                name="password"
                type="password"
                required
                autoComplete="current-password"
                className="mt-1 w-full text-sm font-normal border border-[#E5E5E5] rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#1A1A1A]/10"
              />
            </label>
            {e === "denied" && <p className="text-xs text-[#B91C1C]">That email and password weren&apos;t recognised.</p>}
            {e === "locked" && (
              <p className="text-xs text-[#B91C1C]">Too many attempts. Wait 15 minutes and try again.</p>
            )}
            <button type="submit" className="w-full text-sm font-semibold text-white bg-[#1A1A1A] hover:bg-black px-3.5 py-2 rounded-lg transition-colors">
              View report
            </button>
          </form>
        </main>
      </Shell>
    );
  }

  const report = await getConsentScan(record.scanId);
  if (!report) {
    return (
      <Shell>
        <main className="max-w-[420px] mx-auto px-6 py-16 text-center text-sm text-[#6B6B6B]">This report is no longer available.</main>
      </Shell>
    );
  }

  return (
    <Shell>
      <main className="max-w-[1100px] mx-auto px-6 lg:px-8 py-8 space-y-6 print:px-0 print:py-0 print:max-w-none">
        <div className="flex items-center justify-between gap-3 print:hidden">
          <span className="text-[11px] text-[#9A9A9A]">
            Confidential — view only · link expires {formatDate(record.expiresAt)}
          </span>
          <PrintButton />
        </div>
        <ConsentScanReport report={report} />
      </main>
    </Shell>
  );
}
