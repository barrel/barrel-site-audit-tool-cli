import type { Report, SectionCoverage, SectionKey, SectionStatus } from "@/lib/shared";

/** What the run did not cover, stated on the report rather than left to be inferred from an
 * absent tab.
 *
 * A section that was skipped, one that crashed and one that ran and found nothing used to be the
 * same thing on this page: a tab that wasn't there. The reader most likely to be misled is the one
 * who reads the absence as good news — which is the whole reason the coverage record exists. */

const SECTION_LABELS: Partial<Record<SectionKey, string>> = {
  code: "Theme code",
  themeStructure: "Theme structure",
  themeProfile: "Theme profile",
  themeArchitecture: "Theme architecture",
  performance: "Performance (Lighthouse)",
  accessibility: "Accessibility (axe-core)",
  adaScope: "ADA scope",
  sitespeed: "Sitespeed.io",
  health: "Site health",
  pixels: "Pixels & consent",
  consent: "Privacy Compliance",
  security: "Security & Compliance",
  geoSeo: "SEO & GEO",
  agentReadiness: "Agent readiness",
  ux: "UX & conversion",
  analytics: "Traffic & revenue",
  competitors: "Competitor benchmarking",
  bestPractices: "Shopify best practices",
  aiSuggestions: "AI suggestions",
  summary: "Executive summary",
  recommendations: "Recommendations",
};

function label(key: string): string {
  return SECTION_LABELS[key as SectionKey] ?? key;
}

// Failures first: a section that crashed is the one a reader would most wrongly take for a pass,
// and the only one anyone can act on by re-running.
const GROUPS: { status: SectionStatus; title: string; tone: string }[] = [
  { status: "failed", title: "Could not be measured", tone: "text-[#B91C1C]" },
  { status: "not-applicable", title: "Did not apply to this store", tone: "text-[#D97706]" },
  { status: "skipped", title: "Turned off for this run", tone: "text-[#6B6B6B]" },
];

export function CoverageNote({ report }: { report: Report }) {
  const coverage = report.coverage;
  // Archived reports carry no record. Saying nothing is right: an empty list here would claim
  // full coverage on a run where nothing is known about what ran.
  if (!coverage) return null;

  const entries = Object.entries(coverage) as [SectionKey, SectionCoverage][];
  const gaps = GROUPS.map((group) => ({
    ...group,
    items: entries.filter(([, entry]) => entry.status === group.status),
  })).filter((group) => group.items.length > 0);

  const breakdown = report.scoreBreakdown;
  const truncated = entries.filter(([, entry]) => entry.truncated);

  if (gaps.length === 0 && !breakdown && truncated.length === 0) return null;

  return (
    <div className="mt-6 bg-[#fafafa] border border-[#E5E5E5] rounded-lg px-4 py-3.5">
      <div className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider mb-2">What this run covered</div>

      {breakdown && (
        <p className="text-xs text-[#1A1A1A] mb-2.5 leading-relaxed">
          The overall score averages{" "}
          <strong className="font-semibold">
            {breakdown.contributors.length} of {breakdown.contributors.length + breakdown.missing.length}
          </strong>{" "}
          scored areas. Two reports are only comparable when they scored the same ones.
        </p>
      )}

      {truncated.map(([key, entry]) => (
        <p key={key} className="text-xs text-[#6B6B6B] mb-2.5 leading-relaxed">
          {label(key)} lists the worst{" "}
          <strong className="font-semibold text-[#1A1A1A]">
            {entry.truncated!.kept} of {entry.truncated!.found}
          </strong>{" "}
          {entry.truncated!.what} — the count in that section is a floor, not a total.
        </p>
      ))}

      {gaps.map((group) => (
        <div key={group.status} className="text-xs leading-relaxed">
          <span className={`font-semibold ${group.tone}`}>{group.title}:</span>{" "}
          <span className="text-[#6B6B6B]">
            {group.items.map(([key, entry], i) => (
              <span key={key} title={entry.reason}>
                {i > 0 && ", "}
                <span className="underline decoration-dotted decoration-[#C5C5C5] underline-offset-2">{label(key)}</span>
              </span>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}
