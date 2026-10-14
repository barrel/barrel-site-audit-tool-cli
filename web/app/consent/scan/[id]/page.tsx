import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminsOnlyScreen } from "@/components/AdminsOnly";
import { ConsentScanReport } from "@/components/ConsentScanReport";
import { ConsentShareManager } from "@/components/ConsentShareManager";
import { PrintButton } from "@/components/PrintButton";
import { PageTitle, TopNav } from "@/components/TopNav";
import { getConsentScan } from "@/lib/data";
import { isLabsAdmin } from "@/lib/labs-session";

export const dynamic = "force-dynamic";

export default async function ConsentScanReportPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isLabsAdmin())) return <AdminsOnlyScreen what="Privacy Compliance" />;

  const { id } = await params;
  const report = await getConsentScan(id);
  if (!report) notFound();

  return (
    <div className="min-h-screen bg-[#f9f8f6] print:bg-white">
      <TopNav />
      <PageTitle title="Privacy Compliance — scan report">
        <div className="flex items-center gap-2 print:hidden">
          <Link href={`/consent?scan=${report.id}`} className="text-sm font-medium text-[#2563EB] hover:underline mr-2">
            ← Dashboard
          </Link>
          <a
            href={`/consent/scan/${report.id}/csv`}
            className="text-sm font-semibold text-[#1A1A1A] bg-[#f0efed] hover:bg-[#EDECE8] px-3.5 py-2 rounded-lg transition-colors"
          >
            Download CSV
          </a>
          <PrintButton />
        </div>
      </PageTitle>

      <main className="max-w-[1100px] mx-auto px-6 lg:px-8 py-8 space-y-6 print:px-0 print:py-0 print:max-w-none">
        <ConsentShareManager scanId={report.id} />
        <ConsentScanReport report={report} />
      </main>
    </div>
  );
}
