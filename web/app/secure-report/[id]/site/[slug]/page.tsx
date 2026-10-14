import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConsentSiteReportBody } from "@/components/ConsentSiteReportBody";
import { PrintButton } from "@/components/PrintButton";
import { getConsentScan, getConsentSiteDetail } from "@/lib/data";
import { formatDate } from "@/lib/format";
import { getUnlockedShare } from "@/lib/secure-report-access";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Privacy Compliance report",
  robots: { index: false, follow: false, nocache: true },
};

/** One site's full report behind a secure link. Not unlocked, revoked, expired, or not a site in this
 * link's scan: a plain 404, which reveals nothing about which of those it was. */
export default async function SecureSiteReportPage({ params }: { params: Promise<{ id: string; slug: string }> }) {
  const { id, slug } = await params;
  const record = await getUnlockedShare(id);
  if (!record) return notFound();

  const report = await getConsentScan(record.scanId);
  const row = report?.rows.find((r) => r.slug === slug);
  if (!report || !row) return notFound();

  const detail = await getConsentSiteDetail(report.id, slug);

  return (
    <div className="min-h-screen bg-[#f9f8f6] print:bg-white">
      <header className="bg-white border-b border-[#E5E5E5] px-6 lg:px-8 py-4 print:hidden">
        <span className="text-sm font-semibold text-[#1A1A1A]">Barrel — Privacy Compliance</span>
      </header>
      <main className="max-w-[1200px] mx-auto px-6 lg:px-8 py-8 space-y-5 print:px-0 print:py-0 print:max-w-none">
        <div className="flex items-center justify-between gap-3 print:hidden">
          <Link href={`/secure-report/${id}`} className="text-sm font-medium text-[#2563EB] hover:underline">
            ← All {report.rows.length} sites
          </Link>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-[#9A9A9A]">Confidential — view only · link expires {formatDate(record.expiresAt)}</span>
            <PrintButton />
          </div>
        </div>
        <ConsentSiteReportBody
          report={report}
          row={row}
          detail={detail}
          screenshotHref={(p) => `/api/secure-report/${id}/screenshot/${p.replace(/^screenshots\//, "")}`}
        />
      </main>
    </div>
  );
}
