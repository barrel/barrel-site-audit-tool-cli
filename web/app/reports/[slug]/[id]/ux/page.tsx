import { notFound } from "next/navigation";
import { getReport } from "@/lib/data";
import { ReportNav } from "@/components/ReportNav";
import { EmptyCategoryState } from "@/components/EmptyCategoryState";
import { buildReportSections } from "@/lib/build-report-sections";

export const dynamic = "force-dynamic";

export default async function UxPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const report = await getReport(slug, id);
  if (!report) notFound();

  const uxSections = buildReportSections(report).filter((s) => s.category === "ux");

  if (uxSections.length === 0) {
    return <EmptyCategoryState message="No UX & Conversion data in this report — it was run with --skip-ux." />;
  }

  return (
    <div className="space-y-0">
      {uxSections.map((def, i) => (
        <div key={def.id}>{def.render(String(i + 1).padStart(2, "0"))}</div>
      ))}
    </div>
  );
}
