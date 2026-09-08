import { notFound } from "next/navigation";
import { getReport } from "@/lib/data";
import { ReportSection } from "@/components/ReportSection";
import { DevTodoList } from "@/components/DevTodoList";
import { collectAllFindings } from "@/lib/build-report-sections";
import { buildDevTodo, formatDevTodoMarkdown, formatDevTodoCsv } from "@/lib/findings";

export const dynamic = "force-dynamic";

export default async function DevTodoPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const report = await getReport(slug, id);
  if (!report) notFound();

  const items = buildDevTodo(collectAllFindings(report));
  const markdown = formatDevTodoMarkdown(report, items);
  const csv = formatDevTodoCsv(items);
  const csvFilename = `dev-todo-${report.storeSlug}-${report.id}.csv`;

  return (
    <ReportSection id="dev-todo" number="—" title="Dev To-Do">
      <DevTodoList
        items={items}
        markdown={markdown}
        csv={csv}
        csvFilename={csvFilename}
        storeSlug={report.storeSlug}
        reportUrl={`/reports/${report.storeSlug}/${report.id}`}
      />
    </ReportSection>
  );
}
