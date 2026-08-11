import { notFound } from "next/navigation";
import { getReport } from "@/lib/data";
import { ReportNav } from "@/components/ReportNav";
import { buildReportSections } from "@/lib/build-report-sections";

export const dynamic = "force-dynamic";

export default async function AllSectionsPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const report = await getReport(slug, id);
  if (!report) notFound();

  const sectionDefs = buildReportSections(report);

  return (
    <>
      <ReportNav sections={sectionDefs.map(({ id, label }) => ({ id, label }))} />
      <div className="space-y-0">
        {sectionDefs.map((def, i) => (
          <div key={def.id}>{def.render(String(i + 1).padStart(2, "0"))}</div>
        ))}
      </div>
    </>
  );
}
