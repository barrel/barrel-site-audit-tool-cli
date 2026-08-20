import { notFound } from "next/navigation";
import { getDataAnalysis, getReport, getStoreConfig } from "@/lib/data";
import { EmptyCategoryState } from "@/components/EmptyCategoryState";
import { DataAnalysis } from "@/components/DataAnalysis";
import { ReportSection } from "@/components/ReportSection";

export const dynamic = "force-dynamic";

/** The Data Analysis tab.
 *
 * Reachable only when the store has a GA4 property linked — CategoryNav does not render the tab
 * otherwise. This page re-checks rather than trusting that, because a direct link, a bookmark, or
 * a property unlinked since the tab was last rendered all reach it anyway; and the honest answer
 * there is "nothing is linked", not an empty analysis. */
export default async function DataAnalysisPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const [report, config] = await Promise.all([getReport(slug, id), getStoreConfig(slug)]);
  if (!report) notFound();

  const propertyId = config?.ga4PropertyId;
  if (!propertyId) {
    return (
      <EmptyCategoryState message="No GA4 property is linked to this store, so there is no data to analyse. Link one from the Run Audit page, then come back." />
    );
  }

  const analysis = await getDataAnalysis(slug, id);

  return (
    <div className="space-y-0">
      <ReportSection id="data-analysis" number="01" title="Data Analysis">
        <p className="text-sm text-[#6B6B6B] mb-5 max-w-[860px]">
          This report&rsquo;s findings crossed with the store&rsquo;s own GA4 data, to rank what is worth fixing by
          where conversion is actually weakest. Every figure below comes from the GA4 response or from this report; the
          gap arithmetic is computed here rather than written by the model, and describes days already measured rather
          than forecasting a return.
        </p>
        <DataAnalysis slug={slug} id={id} propertyId={propertyId} initial={analysis} />
      </ReportSection>
    </div>
  );
}
