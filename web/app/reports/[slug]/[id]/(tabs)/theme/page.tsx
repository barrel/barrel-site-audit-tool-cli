import { notFound } from "next/navigation";
import { getReport } from "@/lib/data";
import { ReportNav } from "@/components/ReportNav";
import { EmptyCategoryState } from "@/components/EmptyCategoryState";
import { buildReportSections } from "@/lib/build-report-sections";

export const dynamic = "force-dynamic";

export default async function ThemeCheckPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const report = await getReport(slug, id);
  if (!report) notFound();

  const themeSections = buildReportSections(report).filter((s) => s.category === "theme");

  if (themeSections.length === 0) {
    return (
      <EmptyCategoryState message="No theme code, best-practices, or trust/privacy data in this report." />
    );
  }

  return (
    <>
      <ReportNav sections={themeSections.map(({ id, label }) => ({ id, label }))} />
      <div className="space-y-0">
        {themeSections.map((def, i) => (
          <div key={def.id}>{def.render(String(i + 1).padStart(2, "0"))}</div>
        ))}
      </div>
    </>
  );
}
