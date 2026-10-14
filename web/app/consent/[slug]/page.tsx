import Link from "next/link";
import { AdminsOnlyScreen } from "@/components/AdminsOnly";
import { isLabsAdmin } from "@/lib/labs-session";
import { notFound } from "next/navigation";
import { getConsentSiteDetail, getConsentScan, getLatestConsentScan } from "@/lib/data";
import { screenshotUrl } from "@/lib/screenshot";
import { ConsentSiteReportBody } from "@/components/ConsentSiteReportBody";
import { PrintButton } from "@/components/PrintButton";
import { PageTitle, TopNav } from "@/components/TopNav";

export const dynamic = "force-dynamic";

export default async function ConsentSiteReport({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ scan?: string }>;
}) {
  // Belt as well as braces: middleware already rewrites this route for a non-admin, but a
  // Privacy Compliance page must not depend on the matcher staying correct to stay closed.
  if (!(await isLabsAdmin())) return <AdminsOnlyScreen what="Privacy Compliance" />;

  const { slug } = await params;
  const { scan: scanId } = await searchParams;

  const report = scanId ? await getConsentScan(scanId) : await getLatestConsentScan();
  if (!report) notFound();
  const row = report.rows.find((r) => r.slug === slug);
  if (!row) notFound();

  const detail = await getConsentSiteDetail(report.id, slug);

  return (
    <div className="min-h-screen bg-[#f9f8f6] print:bg-white">
      <TopNav />
      <PageTitle title={row.client}>
        {/* The inventory is the half of this report a client asks for as a spreadsheet, so the
            download sits in the header beside Print rather than buried under the table. Hidden
            when the scan carries no inventory — a link that 404s is worse than no link. */}
        {detail?.inventory && (
          <a
            href={`/api/consent-inventory?scan=${encodeURIComponent(report.id)}&slug=${encodeURIComponent(slug)}&label=${encodeURIComponent(row.client || slug)}`}
            className="text-sm font-medium text-[#2563EB] hover:underline print:hidden"
          >
            Inventory CSV
          </a>
        )}
        <PrintButton />
        <Link href="/consent" className="text-sm font-medium text-[#1A1A1A] hover:text-[#6B6B6B]">
          All sites
        </Link>
      </PageTitle>

      <main className="max-w-[1200px] mx-auto px-6 lg:px-8 py-8 space-y-5 print:px-0 print:py-0 print:max-w-none">
        <ConsentSiteReportBody report={report} row={row} detail={detail} screenshotHref={screenshotUrl} />
      </main>
    </div>
  );
}
