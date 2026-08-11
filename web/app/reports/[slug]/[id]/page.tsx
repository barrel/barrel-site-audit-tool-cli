import { notFound } from "next/navigation";
import { getReport } from "@/lib/data";
import { ReportNav } from "@/components/ReportNav";
import { buildReportSections } from "@/lib/build-report-sections";

export const dynamic = "force-dynamic";

export default async function OverviewPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const report = await getReport(slug, id);
  if (!report) notFound();

  const overviewSections = buildReportSections(report).filter((s) => s.category === "overview");

  return (
    <>
      <ReportNav sections={overviewSections.map(({ id, label }) => ({ id, label }))} />
      <div className="space-y-0">
        {overviewSections.map((def, i) => (
          <div key={def.id}>{def.render(String(i + 1).padStart(2, "0"))}</div>
        ))}
      </div>
    </>
  );
}
