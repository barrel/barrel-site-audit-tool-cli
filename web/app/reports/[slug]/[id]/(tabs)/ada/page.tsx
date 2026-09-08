import { notFound } from "next/navigation";
import { getReport } from "@/lib/data";
import { ReportNav } from "@/components/ReportNav";
import { EmptyCategoryState } from "@/components/EmptyCategoryState";
import { buildReportSections } from "@/lib/build-report-sections";

export const dynamic = "force-dynamic";

export default async function AdaPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const report = await getReport(slug, id);
  if (!report) notFound();

  const adaSections = buildReportSections(report).filter((s) => s.category === "ada");

  if (adaSections.length === 0) {
    return (
      <EmptyCategoryState message="No accessibility data in this report — it was run with --skip-performance and --skip-axe." />
    );
  }

  return (
    <>
      {adaSections.length > 1 && <ReportNav sections={adaSections.map(({ id, label }) => ({ id, label }))} />}
      <div className="space-y-0">
        {adaSections.map((def, i) => (
          <div key={def.id}>{def.render(String(i + 1).padStart(2, "0"))}</div>
        ))}
      </div>
    </>
  );
}
