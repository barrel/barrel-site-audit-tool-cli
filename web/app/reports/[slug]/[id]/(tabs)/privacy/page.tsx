import { notFound } from "next/navigation";
import { getReport } from "@/lib/data";
import { ReportNav } from "@/components/ReportNav";
import { EmptyCategoryState } from "@/components/EmptyCategoryState";
import { buildReportSections } from "@/lib/build-report-sections";

export const dynamic = "force-dynamic";

/** Privacy & Compliance — Privacy Compliance, Security & Compliance and Trust & Privacy, which
 * used to sit at the bottom of Overview. They are one subject (what the storefront exposes to a
 * visitor and to the network) scored on one scale, and Overview was burying the page a client is
 * most likely to forward. */
export default async function PrivacyPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const report = await getReport(slug, id);
  if (!report) notFound();

  const privacySections = buildReportSections(report).filter((s) => s.category === "privacy");

  if (privacySections.length === 0) {
    return (
      <EmptyCategoryState message="No privacy, security or trust data in this report — it was run with --skip-consent, --skip-security, --skip-pixels and --skip-performance." />
    );
  }

  return (
    <>
      {privacySections.length > 1 && (
        <ReportNav sections={privacySections.map(({ id, label }) => ({ id, label }))} />
      )}
      <div className="space-y-0">
        {privacySections.map((def, i) => (
          <div key={def.id}>{def.render(String(i + 1).padStart(2, "0"))}</div>
        ))}
      </div>
    </>
  );
}
