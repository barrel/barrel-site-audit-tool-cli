import { average, type ReportSections, type ScoreBreakdown, type ScoreContributor } from "@barrel/site-audit-shared";

/** The scored areas, in the order they are averaged and shown.
 *
 * One list rather than a chain of `if (sections.x) scores.push(...)` statements, because the same
 * list has to answer three questions that were previously answered separately and disagreed: what
 * the overall score is an average of, which gauges the scorecard shows (the deck's showed eight of
 * the then-fourteen while the slide beside it said the score covered "the N areas it measured"),
 * and what is missing from a given run.
 *
 * Consent and security are deliberately absent — see buildScoreBreakdown. */
const SCORED_AREAS: {
  id: string;
  label: string;
  section: keyof ReportSections;
  read: (sections: ReportSections) => number | undefined;
}[] = [
  { id: "code", label: "Theme code", section: "code", read: (s) => s.code?.score },
  { id: "themeStructure", label: "Theme structure", section: "themeStructure", read: (s) => s.themeStructure?.score },
  { id: "lighthousePerformance", label: "Performance", section: "performance", read: (s) => s.performance?.performance.score },
  {
    id: "lighthouseAccessibility",
    label: "Accessibility (Lighthouse)",
    section: "performance",
    read: (s) => s.performance?.accessibility.score,
  },
  {
    id: "lighthouseBestPractices",
    label: "Best practices (Lighthouse)",
    section: "performance",
    read: (s) => s.performance?.bestPractices.score,
  },
  { id: "lighthouseSeo", label: "SEO (Lighthouse)", section: "performance", read: (s) => s.performance?.seo.score },
  { id: "axe", label: "Accessibility (axe-core)", section: "accessibility", read: (s) => s.accessibility?.score },
  { id: "sitespeed", label: "sitespeed.io", section: "sitespeed", read: (s) => s.sitespeed?.score },
  { id: "health", label: "Site health", section: "health", read: (s) => s.health?.score },
  { id: "pixels", label: "Pixels & consent", section: "pixels", read: (s) => s.pixels?.score },
  { id: "geoSeo", label: "SEO & GEO", section: "geoSeo", read: (s) => s.geoSeo?.healthRating },
  { id: "agentReadiness", label: "Agent readiness", section: "agentReadiness", read: (s) => s.agentReadiness?.score },
  { id: "ux", label: "UX & conversion", section: "ux", read: (s) => s.ux?.score },
];

/** What the headline score is an average of, and what it leaves out.
 *
 * Consent and security are not in it, and that is a change. Both were averaged in alongside
 * Lighthouse's 0-100s, which scoring.ts's own `complianceBand` doc says they must not be: a
 * compliance score is a weighted proportion of what could be *confirmed*, not a percentage of a
 * fixed total, and one unresolved blocker scales it into the bottom half by design. Blending that
 * with a Lighthouse score produces a number that is neither. They keep their own scale and their
 * own band, and surface as exposure rather than as a grade. */
export function buildScoreBreakdown(sections: ReportSections): ScoreBreakdown {
  const contributors: ScoreContributor[] = [];
  const missing: ScoreBreakdown["missing"] = [];

  for (const area of SCORED_AREAS) {
    const score = area.read(sections);
    const { id, label, section } = area;
    if (typeof score === "number" && Number.isFinite(score)) contributors.push({ id, label, section, score });
    else missing.push({ id, label, section });
  }

  return {
    score: average(contributors.map((c) => c.score)),
    contributors,
    missing,
  };
}
