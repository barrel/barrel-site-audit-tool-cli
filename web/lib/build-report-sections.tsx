import Link from "next/link";
import { GradePill } from "@/components/ScoreBadge";
import { StatTile } from "@/components/StatTile";
import { ReportSection } from "@/components/ReportSection";
import { MeterGrid } from "@/components/MeterGrid";
import { DeviceScoreComparison } from "@/components/DeviceScoreComparison";
import { CoreWebVitalsTable } from "@/components/CoreWebVitalsTable";
import { LighthousePagesTable } from "@/components/LighthousePagesTable";
import { FindingCard } from "@/components/FindingCard";
import { RoadmapTable } from "@/components/RoadmapTable";
import { IssueTable } from "@/components/IssueTable";
import { SitespeedMetrics } from "@/components/SitespeedMetrics";
import { HealthChecklist } from "@/components/HealthChecklist";
import { AdaScopeChecklist } from "@/components/AdaScopeChecklist";
import { PixelAudit } from "@/components/PixelAudit";
import { ThemeStructure } from "@/components/ThemeStructure";
import { BestPracticesTable } from "@/components/BestPracticesTable";
import { AnalyticsSection } from "@/components/AnalyticsSection";
import { CompetitorComparison } from "@/components/CompetitorComparison";
import { screenshotUrl } from "@/lib/screenshot";
import { formatDate } from "@/lib/format";
import type { Report } from "@/lib/shared";
import {
  lighthouseFindings,
  healthFindings,
  pixelToFindings,
  seoOpportunityFindings,
  uxOpportunityFindings,
  aiSuggestionFindings,
  axeFindings,
  adaScopeFindings,
  sitespeedAdviceFindings,
  consoleErrorFindings,
  themeConcernFindings,
  agentReadinessIssueFindings,
  buildRoadmap,
  type Finding,
} from "@/lib/findings";

export type ReportCategory = "overview" | "vitals" | "theme" | "ux" | "seo-geo" | "ada";

export interface SectionDef {
  id: string;
  label: string;
  category: ReportCategory;
  render: (number: string) => React.ReactNode;
}

export const CATEGORY_LABELS: Record<ReportCategory, string> = {
  overview: "Overview",
  vitals: "Site Vitals",
  theme: "Theme Check",
  ux: "UX",
  "seo-geo": "SEO/GEO",
  ada: "ADA",
};

/** Gathers every actionable finding across the whole report into one flat list — the source
 * of truth for both the Overview page's Prioritized Roadmap (top 10) and the full Dev To-Do
 * page (everything), so the two can never drift out of sync with each other. */
export function collectAllFindings(report: Report): Finding[] {
  const { sections } = report;

  const perfFindings = sections.performance ? lighthouseFindings(sections.performance.performance, "perf") : [];
  const a11yFindings = sections.performance ? lighthouseFindings(sections.performance.accessibility, "a11y") : [];
  const axeFindingsList = sections.accessibility ? axeFindings(sections.accessibility.pages) : [];
  const sitespeedFindingsList = sections.sitespeed ? sitespeedAdviceFindings(sections.sitespeed.advice) : [];
  const seoLighthouseFindings = sections.performance ? lighthouseFindings(sections.performance.seo, "seo") : [];
  const seoHealthFindings = sections.health ? healthFindings(sections.health.checks) : [];
  const seoFindings = [...seoLighthouseFindings, ...seoHealthFindings];
  const bestPracticeLighthouseFindings = sections.performance
    ? lighthouseFindings(sections.performance.bestPractices, "bp")
    : [];
  const consentFindings = sections.pixels ? pixelToFindings(sections.pixels.findings) : [];
  const consoleErrorFindingsList = sections.performance ? consoleErrorFindings(sections.performance.consoleErrors ?? []) : [];
  const trustFindings = [...bestPracticeLighthouseFindings, ...consentFindings];
  const seoOppFindings = sections.geoSeo ? seoOpportunityFindings(sections.geoSeo.seo.opportunities) : [];
  const uxOppFindings = sections.ux ? uxOpportunityFindings(sections.ux.opportunities) : [];
  const aiSuggestionFindingsList = sections.aiSuggestions ? aiSuggestionFindings(sections.aiSuggestions.suggestions) : [];
  const themeConcernFindingsList = sections.themeArchitecture ? themeConcernFindings(sections.themeArchitecture.concerns) : [];
  const agentReadinessFindingsList = sections.agentReadiness ? agentReadinessIssueFindings(sections.agentReadiness.issues) : [];
  const adaScopeFindingsList = sections.adaScope ? adaScopeFindings(sections.adaScope) : [];

  const allFindings: Finding[] = [
    ...perfFindings,
    ...a11yFindings,
    ...axeFindingsList,
    ...adaScopeFindingsList,
    ...sitespeedFindingsList,
    ...seoFindings,
    ...trustFindings,
    ...consoleErrorFindingsList,
    ...agentReadinessFindingsList,
    ...seoOppFindings,
    ...uxOppFindings,
    ...aiSuggestionFindingsList,
    ...themeConcernFindingsList,
  ];
  if (sections.themeStructure) {
    for (const flag of sections.themeStructure.redFlags) {
      allFindings.push({
        id: `theme-${flag.label}`,
        title: flag.label,
        severity: "medium",
        description: flag.detail,
        scope: "Site-wide",
        recommendation: flag.recommendation,
      });
    }
  }
  if (sections.code) {
    for (const issue of sections.code.issues.filter((i) => i.severity === "error")) {
      allFindings.push({
        id: `code-${issue.file}-${issue.line ?? 0}`,
        title: issue.check,
        severity: "high",
        description: `${issue.message} (${issue.file}${issue.line ? `:${issue.line}` : ""})`,
        scope: `Theme file: ${issue.file}${issue.line ? `:${issue.line}` : ""}`,
        recommendation: issue.recommendation,
        file: issue.file,
        line: issue.line,
      });
    }
  }
  return allFindings;
}

/** Builds every section of a report, tagged by which category page it belongs on
 * (see ReportCategory). Shared by the Overview page, each category page, and the "All" page
 * (which just renders every section this returns, in order) — one source of truth for the
 * report's content so the pages can't drift out of sync with each other. */
export function buildReportSections(report: Report): SectionDef[] {
  const { sections } = report;

  const perfFindings = sections.performance ? lighthouseFindings(sections.performance.performance, "perf") : [];
  const a11yFindings = sections.performance ? lighthouseFindings(sections.performance.accessibility, "a11y") : [];
  const axeFindingsList = sections.accessibility ? axeFindings(sections.accessibility.pages) : [];
  const sitespeedFindingsList = sections.sitespeed ? sitespeedAdviceFindings(sections.sitespeed.advice) : [];
  const seoLighthouseFindings = sections.performance ? lighthouseFindings(sections.performance.seo, "seo") : [];
  const seoHealthFindings = sections.health ? healthFindings(sections.health.checks) : [];
  const seoFindings = [...seoLighthouseFindings, ...seoHealthFindings];
  const bestPracticeLighthouseFindings = sections.performance
    ? lighthouseFindings(sections.performance.bestPractices, "bp")
    : [];
  const consentFindings = sections.pixels ? pixelToFindings(sections.pixels.findings) : [];
  const consoleErrorFindingsList = sections.performance ? consoleErrorFindings(sections.performance.consoleErrors ?? []) : [];
  const trustFindings = [...bestPracticeLighthouseFindings, ...consentFindings];
  const seoOppFindings = sections.geoSeo ? seoOpportunityFindings(sections.geoSeo.seo.opportunities) : [];
  const uxOppFindings = sections.ux ? uxOpportunityFindings(sections.ux.opportunities) : [];
  const themeConcernFindingsList = sections.themeArchitecture ? themeConcernFindings(sections.themeArchitecture.concerns) : [];
  const agentReadinessFindingsList = sections.agentReadiness ? agentReadinessIssueFindings(sections.agentReadiness.issues) : [];
  const aiPerfSuggestions = sections.aiSuggestions?.suggestions.filter((s) => s.category === "performance") ?? [];
  const aiA11ySuggestions = sections.aiSuggestions?.suggestions.filter((s) => s.category === "accessibility") ?? [];

  const allFindings = collectAllFindings(report);
  const roadmap = buildRoadmap(allFindings);

  const stats: { label: string; score: number }[] = [{ label: "Overall Score", score: report.overallScore }];
  if (sections.performance) stats.push({ label: "Performance", score: sections.performance.performance.score });
  if (sections.health) stats.push({ label: "Site Health", score: sections.health.score });
  if (sections.geoSeo) stats.push({ label: "SEO & GEO Health", score: sections.geoSeo.healthRating });
  if (sections.pixels) stats.push({ label: "Trust & Privacy", score: sections.pixels.score });
  if (sections.themeStructure) stats.push({ label: "Theme Structure", score: sections.themeStructure.score });
  if (sections.code) stats.push({ label: "Theme Code", score: sections.code.score });

  const sectionDefs: SectionDef[] = [
    {
      id: "summary",
      label: "Summary",
      category: "overview",
      render: (n) => (
        <ReportSection id="summary" number={n} title="Executive Summary" action={<GradePill score={report.overallScore} />}>
          <div className="flex flex-col lg:flex-row gap-8">
            <div className="max-w-[720px] flex-1">
              <p className="text-[15px] text-[#1A1A1A] leading-relaxed">
                {sections.summary?.overview ??
                  `This audit produced an overall grade of ${report.overallScore}/100 across the areas analyzed below.`}
              </p>
              {sections.summary && sections.summary.keyFindings.length > 0 && (
                <ul className="space-y-2 mt-4">
                  {sections.summary.keyFindings.map((finding, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-[#1A1A1A]">
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#1A1A1A]/40 shrink-0" />
                      {finding}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 lg:w-[320px] shrink-0 lg:self-start">
              {stats.slice(0, 4).map((s) => (
                <div key={s.label} className="bg-white border border-[#E5E5E5] rounded-lg">
                  <StatTile label={s.label} score={s.score} />
                </div>
              ))}
            </div>
          </div>
        </ReportSection>
      ),
    },
  ];

  if (sections.analytics) {
    const analytics = sections.analytics;
    sectionDefs.push({
      id: "analytics",
      label: "Traffic & Revenue",
      category: "overview",
      render: (n) => (
        <ReportSection id="analytics" number={n} title="Traffic & Revenue">
          <AnalyticsSection analytics={analytics} />
        </ReportSection>
      ),
    });
  }

  if (sections.performance) {
    const performance = sections.performance;
    const journeyPages = [...new Set((performance.pages ?? []).map((p) => p.page))];
    sectionDefs.push({
      id: "vitals",
      label: "Vitals",
      category: "vitals",
      render: (n) => (
        <ReportSection id="vitals" number={n} title="Lighthouse Vitals" action={<GradePill score={performance.performance.score} />}>
          <p className="text-sm text-[#6B6B6B] mb-5 max-w-[720px]">
            {journeyPages.length > 1 ? (
              <>
                Lighthouse run directly against the live site for both mobile and desktop, across the{" "}
                {journeyPages.length} pages that carry the shopping journey: {journeyPages.join(", ")}.
              </>
            ) : (
              <>
                Lighthouse run directly against{" "}
                <span className="font-mono text-[#1A1A1A]">{performance.finalUrl}</span> for both mobile and
                desktop.
              </>
            )}
          </p>
          <div className="space-y-5">
            <DeviceScoreComparison
              mobile={{
                performance: performance.performance.score,
                accessibility: performance.accessibility.score,
                bestPractices: performance.bestPractices.score,
                seo: performance.seo.score,
              }}
              desktop={(() => {
                const home = performance.pages?.find((p) => p.page === "Home" && p.device === "desktop");
                return home
                  ? {
                      performance: home.performance,
                      accessibility: home.accessibility,
                      bestPractices: home.bestPractices,
                      seo: home.seo,
                    }
                  : undefined;
              })()}
            />
            {performance.vitals && <CoreWebVitalsTable vitals={performance.vitals} />}
            {performance.pages && performance.pages.length > 0 && (
              <div className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden">
                <LighthousePagesTable pages={performance.pages} />
              </div>
            )}
            {performance.screenshotPath && (
              <a
                href={screenshotUrl(performance.screenshotPath)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block bg-white border border-[#E5E5E5] rounded-lg overflow-hidden hover:border-[#1A1A1A]/30 transition-colors"
              >
                <div className="px-4 py-2 bg-[#fafafa] text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider border-b border-[#E5E5E5]">
                  Homepage screenshot (mobile)
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={screenshotUrl(performance.screenshotPath)}
                  alt={`${report.storeName} homepage screenshot`}
                  className="w-[200px] h-auto block"
                />
              </a>
            )}
          </div>
        </ReportSection>
      ),
    });

    sectionDefs.push({
      id: "performance",
      label: "Performance",
      category: "vitals",
      render: (n) => (
        <ReportSection id="performance" number={n} title="Performance" action={<GradePill score={performance.performance.score} />}>
          {perfFindings.length === 0 ? (
            <FindingCard
              finding={{ id: "perf-good", title: "No notable performance issues", severity: "good", description: "All measured performance audits passed." }}
            />
          ) : (
            <div className="space-y-4">
              {perfFindings.map((f) => (
                <FindingCard key={f.id} finding={f} />
              ))}
            </div>
          )}
        </ReportSection>
      ),
    });

    if (performance.agenticBrowsing) {
      const agentic = performance.agenticBrowsing;
      const fractionColor = agentic.passed === agentic.total ? "#10B981" : agentic.passed === 0 ? "#B91C1C" : "#D97706";
      sectionDefs.push({
        id: "agentic-browsing",
        label: "Agentic Browsing",
        category: "vitals",
        render: (n) => (
          <ReportSection
            id="agentic-browsing"
            number={n}
            title="Agentic Browsing"
            action={
              <span
                className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums"
                style={{ backgroundColor: `${fractionColor}1A`, color: fractionColor }}
              >
                {agentic.passed}/{agentic.total}
              </span>
            }
          >
            <p className="text-sm text-[#6B6B6B] mb-5 max-w-[720px]">
              Lighthouse's newest category — how well an AI agent (a browser-use agent, not a search
              crawler) can navigate and act on the homepage: agent-facing accessibility-tree quality,
              WebMCP integration, layout stability, and an <code className="bg-[#fafafa] px-1 rounded">llms.txt</code>.
              Still experimental upstream and scored as a pass/fail ratio rather than 0-100, so it isn't
              factored into the overall score.
            </p>
            <div className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden">
              <HealthChecklist checks={agentic.checks} />
            </div>
          </ReportSection>
        ),
      });
    }

  }

  if (sections.sitespeed) {
    const sitespeed = sections.sitespeed;
    sectionDefs.push({
      id: "sitespeed",
      label: "Sitespeed.io",
      category: "vitals",
      render: (n) => (
        <ReportSection id="sitespeed" number={n} title="Sitespeed.io" action={<GradePill score={sitespeed.score} />}>
          <p className="text-sm text-[#6B6B6B] mb-5 max-w-[720px]">
            A second, independent performance signal — median across {sitespeed.runs} real-browser (Chrome via
            Browsertime) iterations, scored by Coach against its own performance, best-practice, and privacy rule
            set. Different methodology than the single synthetic Lighthouse trace above, so it can surface
            different issues.
          </p>
          <div className="space-y-5">
            <MeterGrid meters={sitespeed.categoryScores.map((c) => ({ label: c.category, score: c.score }))} />
            <SitespeedMetrics metrics={sitespeed.metrics} />
          </div>
          <div className="mt-6">
            {sitespeedFindingsList.length === 0 ? (
              <FindingCard
                finding={{
                  id: "sitespeed-good",
                  title: "No notable Coach advice",
                  severity: "good",
                  description: "Every measured Coach rule scored 100.",
                }}
              />
            ) : (
              <div className="space-y-4">
                {sitespeedFindingsList.map((f) => (
                  <FindingCard key={f.id} finding={f} />
                ))}
              </div>
            )}
          </div>
        </ReportSection>
      ),
    });
  }

  // First on the ADA tab: when a client has a contractual accessibility scope, "did we deliver
  // what was scoped?" is the question the report exists to answer, and the axe/Lighthouse detail
  // below it is the evidence.
  if (sections.adaScope && sections.adaScope.items.length > 0) {
    const adaScope = sections.adaScope;
    const automatable = adaScope.completeCount + adaScope.partialCount + adaScope.incompleteCount;
    const meters = [
      ...(automatable > 0 ? [{ label: "Scope Verified", score: adaScope.coverage }] : []),
      ...(adaScope.lighthouseAccessibilityScore !== undefined
        ? [{ label: "Lighthouse Accessibility", score: adaScope.lighthouseAccessibilityScore }]
        : []),
      ...(adaScope.axeScore !== undefined ? [{ label: "Axe Automated Scan", score: adaScope.axeScore }] : []),
    ];

    sectionDefs.push({
      id: "ada-scope",
      label: "ADA Scope Checker",
      category: "ada",
      render: (n) => (
        <ReportSection
          id="ada-scope"
          number={n}
          title="ADA Scope Checker"
          action={automatable > 0 ? <GradePill score={adaScope.coverage} /> : undefined}
        >
          <p className="text-sm text-[#6B6B6B] mb-5 max-w-[720px]">
            The accessibility scope agreed for this client, checked line by line against what this run actually
            measured — axe-core rules, Google Lighthouse&apos;s accessibility audit, and a live pass that tabs through
            each page to test keyboard reach, focus visibility and the skip-navigation link. A ticked box means an
            automated check verified it; anything else carries a specific developer action naming the failing elements.
            {automatable > 0 && (
              <>
                {" "}
                The grade is scope completion ({adaScope.completeCount} of {automatable} automatically-verifiable
                items), not a site-quality score, so it stays out of the report&apos;s overall score.
              </>
            )}
          </p>

          {meters.length > 0 && (
            <div className="mb-6">
              <MeterGrid meters={meters} />
            </div>
          )}

          <AdaScopeChecklist
            section={adaScope}
            storeName={report.storeName}
            reportDate={formatDate(report.createdAt)}
            storageKey={`barrel-ada-scope:${report.storeSlug}:${report.id}`}
          />
        </ReportSection>
      ),
    });
  }

  if (sections.performance || sections.accessibility) {
    const performance = sections.performance;
    const accessibility = sections.accessibility;
    const adaScores = [performance?.accessibility.score, accessibility?.score].filter(
      (s): s is number => s !== undefined,
    );
    const adaScore = Math.round(adaScores.reduce((a, b) => a + b, 0) / adaScores.length);
    const axePages = accessibility?.pages ?? [];

    sectionDefs.push({
      id: "accessibility",
      label: "Accessibility",
      category: "ada",
      render: (n) => (
        <ReportSection id="accessibility" number={n} title="Accessibility" action={<GradePill score={adaScore} />}>
          <p className="text-sm text-[#6B6B6B] mb-5 max-w-[720px]">
            {accessibility ? (
              <>
                {performance && <>Combines Lighthouse&apos;s accessibility audit (homepage, mobile) with an </>}
                {!performance && <>An </>}
                automated <span className="font-mono text-[#1A1A1A]">axe-core</span> scan across every discovered
                journey page ({axePages.map((p) => p.page).join(", ")})
                {performance && <> — axe catches issues Lighthouse&apos;s fixed audit set doesn&apos;t, like keyboard
                traps or ARIA misuse on widgets that render after first paint.</>}
                {!performance && <>.</>}
              </>
            ) : (
              <>
                Lighthouse&apos;s accessibility audit, homepage/mobile only — run without{" "}
                <span className="font-mono text-[#1A1A1A]">--skip-axe</span> for a deeper automated scan across every
                journey page.
              </>
            )}
          </p>

          {performance && accessibility && (
            <div className="mb-6">
              <MeterGrid
                meters={[
                  { label: "Lighthouse Accessibility", score: performance.accessibility.score },
                  { label: "Axe Automated Scan", score: accessibility.score },
                ]}
              />
            </div>
          )}

          {accessibility && (
            <div className="mb-6">
              <div className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider mb-3">
                WCAG Readiness Checklist
              </div>
              <div className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden">
                <HealthChecklist checks={accessibility.checklist} />
              </div>
            </div>
          )}

          {performance && (
            <div className="mb-6">
              <div className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider mb-3">
                Lighthouse Findings
              </div>
              {a11yFindings.length === 0 ? (
                <FindingCard
                  finding={{ id: "a11y-good", title: "No notable accessibility issues", severity: "good", description: "All measured accessibility audits passed." }}
                />
              ) : (
                <div className="space-y-4">
                  {a11yFindings.map((f) => (
                    <FindingCard key={f.id} finding={f} />
                  ))}
                </div>
              )}
            </div>
          )}

          {accessibility && (
            <div>
              <div className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider mb-3">
                Axe Violations — Actionable Items
              </div>
              {axeFindingsList.length === 0 ? (
                <FindingCard
                  finding={{ id: "axe-good", title: "No axe-detected violations", severity: "good", description: `No accessibility violations found across ${axePages.length} page(s) scanned.` }}
                />
              ) : (
                <div className="space-y-4">
                  {axeFindingsList.map((f) => (
                    <FindingCard key={f.id} finding={f} />
                  ))}
                </div>
              )}
            </div>
          )}
        </ReportSection>
      ),
    });
  }

  if (aiPerfSuggestions.length > 0) {
    sectionDefs.push({
      id: "ai-suggestions-performance",
      label: "AI Performance Suggestions",
      category: "vitals",
      render: (n) => (
        <ReportSection id="ai-suggestions-performance" number={n} title="AI Performance Suggestions">
          <p className="text-sm text-[#6B6B6B] mb-5 max-w-[720px]">
            Claude-generated, prioritized performance fixes grounded in the Lighthouse signals above and — when
            theme source code was available — the actual theme files. Advisory only; not part of any score.
          </p>
          <div className="space-y-4">
            {aiSuggestionFindings(aiPerfSuggestions).map((f) => (
              <FindingCard key={f.id} finding={f} />
            ))}
          </div>
        </ReportSection>
      ),
    });
  }

  if (sections.performance || sections.health) {
    const seoScores = [sections.performance?.seo.score, sections.health?.score].filter(
      (s): s is number => s !== undefined,
    );
    const seoSectionScore = Math.round(seoScores.reduce((a, b) => a + b, 0) / seoScores.length);
    sectionDefs.push({
      id: "seo",
      label: "Technical & SEO",
      category: "seo-geo",
      render: (n) => (
        <ReportSection id="seo" number={n} title="Technical Health & SEO" action={<GradePill score={seoSectionScore} />}>
          {seoFindings.length === 0 ? (
            <FindingCard
              finding={{ id: "seo-good", title: "Technical health & SEO look solid", severity: "good", description: "Meta tags, structured data, and crawlability checks all passed." }}
            />
          ) : (
            <div className="space-y-4">
              {seoFindings.map((f) => (
                <FindingCard key={f.id} finding={f} />
              ))}
            </div>
          )}
          {sections.health && (
            <details className="mt-5">
              <summary className="text-sm text-[#6B6B6B] cursor-pointer hover:text-[#1A1A1A]">
                Full site health checklist
              </summary>
              <div className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden mt-3">
                <HealthChecklist checks={sections.health.checks} />
              </div>
            </details>
          )}
        </ReportSection>
      ),
    });
  }

  if (sections.geoSeo) {
    const seo = sections.geoSeo.seo;
    sectionDefs.push({
      id: "seo-opportunities",
      label: "SEO Opportunities",
      category: "seo-geo",
      render: (n) => (
        <ReportSection id="seo-opportunities" number={n} title="SEO Opportunities" action={<GradePill score={seo.score} />}>
          <p className="text-sm text-[#6B6B6B] mb-5 max-w-[720px]">
            Concrete, homepage-level fixes for traditional search — title and meta description
            length, heading structure, Open Graph tags, and canonical URL — each with a specific
            recommendation.
          </p>
          {seoOppFindings.length === 0 ? (
            <FindingCard
              finding={{
                id: "seo-opp-good",
                title: "No major SEO opportunities found",
                severity: "good",
                description: "Title, meta description, headings, Open Graph, and canonical tags all look solid.",
              }}
            />
          ) : (
            <div className="space-y-4">
              {seoOppFindings.map((f) => (
                <FindingCard key={f.id} finding={f} />
              ))}
            </div>
          )}
        </ReportSection>
      ),
    });
  }

  if (sections.geoSeo) {
    const geo = sections.geoSeo.geo;
    const areasToImprove = [
      ...geo.checks
        .filter((c) => c.status !== "pass")
        .map((c) => ({ label: c.label, detail: c.detail, rank: c.status === "fail" ? 0 : 1 })),
      ...geo.agenticCommerce
        .filter((r) => r.verdict !== "good")
        .map((r) => ({ label: r.dimension, detail: r.evidence, rank: r.verdict === "poor" ? 0 : 1 })),
    ].sort((a, b) => a.rank - b.rank);

    sectionDefs.push({
      id: "geo",
      label: "GEO",
      category: "seo-geo",
      render: (n) => (
        <ReportSection id="geo" number={n} title="GEO — Generative Engine Optimization" action={<GradePill score={geo.score} />}>
          <p className="text-sm text-[#6B6B6B] mb-4 max-w-[720px]">
            GEO is how discoverable — and purchasable — this storefront is to AI answer engines
            (ChatGPT, Claude, Perplexity, Gemini) and the AI shopping agents that are starting to
            browse, compare, and check out on a customer's behalf. Where classic SEO optimizes for
            a search-results click, GEO optimizes for being the source an AI model reads, trusts,
            and cites — or the catalog an AI agent can accurately transact against.
          </p>
          <p className="text-sm text-[#6B6B6B] mb-6 max-w-[720px]">
            <span className="font-semibold text-[#1A1A1A]">Agentic commerce</span> is the emerging
            layer on top of that: protocols like Shopify's Agentic Commerce and OpenAI's Instant
            Checkout let an AI agent complete a real purchase directly, without the shopper ever
            visiting the site in a browser. That only works if the storefront exposes accurate,
            machine-readable product, price, and availability data — the checks below are a proxy
            for exactly that.
          </p>

          <div className="mb-6">
            <div className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider mb-3">
              GEO Readiness Checks
            </div>
            <div className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden">
              <HealthChecklist checks={geo.checks} />
            </div>
          </div>

          <div className="mb-6">
            <div className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider mb-3">
              Agentic Commerce & AI Discoverability Best Practices
            </div>
            <div className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden">
              <BestPracticesTable rows={geo.agenticCommerce} />
            </div>
          </div>

          <div>
            <div className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider mb-3">
              Areas to Improve
            </div>
            {areasToImprove.length === 0 ? (
              <FindingCard
                finding={{
                  id: "geo-good",
                  title: "No major GEO gaps found",
                  severity: "good",
                  description: "AI crawler access, llms.txt, structured product data, and agentic-commerce readiness all look solid.",
                }}
              />
            ) : (
              <ul className="space-y-2.5 bg-white border border-[#E5E5E5] rounded-lg px-5 py-4">
                {areasToImprove.map((a, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-[#1A1A1A]">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#D97706] shrink-0" />
                    <span>
                      <span className="font-semibold">{a.label}.</span>{" "}
                      <span className="text-[#6B6B6B]">{a.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </ReportSection>
      ),
    });
  }

  if (sections.agentReadiness) {
    const agentReadiness = sections.agentReadiness;
    sectionDefs.push({
      id: "agent-readiness",
      label: "Agent Readiness",
      category: "seo-geo",
      render: (n) => (
        <ReportSection
          id="agent-readiness"
          number={n}
          title="Agent Readiness"
          action={<GradePill score={agentReadiness.score} />}
        >
          <p className="text-sm text-[#6B6B6B] mb-6 max-w-[820px]">
            Whether AI shopping agents (ChatGPT, Gemini, Perplexity Shopping) can actually
            transact against this catalog, not just discover it: per-SKU Offer schema — checked
            on every sampled variant, not one product sampled once — server-rendered price/stock
            (an agent that has to execute heavy JavaScript to see current price or stock will
            often abandon the crawl), machine-readable return/shipping policy data, consistent
            attribute labeling across SKUs, and price agreement between the product feed and the
            live product page. Sampled {agentReadiness.skusSampled} SKU(s) across up to 8
            products.
          </p>

          <div className="mb-6">
            <div className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider mb-3">
              Agent Readiness Checks
            </div>
            <div className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden">
              <HealthChecklist checks={agentReadiness.checks} />
            </div>
          </div>

          <div>
            <div className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider mb-3">
              SKU &amp; Catalog Issues
            </div>
            {agentReadinessFindingsList.length === 0 ? (
              <FindingCard
                finding={{
                  id: "agent-readiness-good",
                  title: "No agent-readiness issues found",
                  severity: "good",
                  description: "Every sampled SKU and catalog-level check passed.",
                }}
              />
            ) : (
              <div className="space-y-4">
                {agentReadinessFindingsList.map((f) => (
                  <FindingCard key={f.id} finding={f} />
                ))}
              </div>
            )}
          </div>
        </ReportSection>
      ),
    });
  }

  if (sections.ux) {
    const ux = sections.ux;
    sectionDefs.push({
      id: "ux",
      label: "UX & Conversion",
      category: "ux",
      render: (n) => (
        <ReportSection id="ux" number={n} title="UX & Conversion" action={<GradePill score={ux.score} />}>
          <p className="text-sm text-[#6B6B6B] mb-5 max-w-[720px]">
            A focused conversion-rate review of one collection page and one product page — not a
            full-site crawl. Combines deterministic checks (add-to-cart visibility, reviews, trust
            badges, filters) with an AI-generated critique grounded in what's actually visible on
            each page.
          </p>

          {(ux.collectionPage?.screenshotPath || ux.productPage?.screenshotPath) && (
            <div className="flex flex-wrap gap-4 mb-6">
              {ux.collectionPage?.screenshotPath && (
                <a
                  href={screenshotUrl(ux.collectionPage.screenshotPath)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block bg-white border border-[#E5E5E5] rounded-lg overflow-hidden hover:border-[#1A1A1A]/30 transition-colors"
                >
                  <div className="px-4 py-2 bg-[#fafafa] text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider border-b border-[#E5E5E5]">
                    Collection page
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={screenshotUrl(ux.collectionPage.screenshotPath)}
                    alt="Collection page screenshot"
                    className="w-[240px] h-auto block"
                  />
                </a>
              )}
              {ux.productPage?.screenshotPath && (
                <a
                  href={screenshotUrl(ux.productPage.screenshotPath)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block bg-white border border-[#E5E5E5] rounded-lg overflow-hidden hover:border-[#1A1A1A]/30 transition-colors"
                >
                  <div className="px-4 py-2 bg-[#fafafa] text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider border-b border-[#E5E5E5]">
                    Product page
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={screenshotUrl(ux.productPage.screenshotPath)}
                    alt="Product page screenshot"
                    className="w-[240px] h-auto block"
                  />
                </a>
              )}
            </div>
          )}

          <div className="mb-6">
            <div className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider mb-3">
              Conversion Checks
            </div>
            <div className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden">
              <HealthChecklist checks={ux.checks} />
            </div>
          </div>

          <div>
            <div className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider mb-3">
              UX Opportunities
            </div>
            {uxOppFindings.length === 0 ? (
              <FindingCard
                finding={{
                  id: "ux-good",
                  title: "No major UX opportunities found",
                  severity: "good",
                  description: "Add-to-cart visibility, reviews, trust badges, and navigation all look solid on the pages reviewed.",
                }}
              />
            ) : (
              <div className="space-y-4">
                {uxOppFindings.map((f) => (
                  <FindingCard key={f.id} finding={f} />
                ))}
              </div>
            )}
          </div>
        </ReportSection>
      ),
    });
  }

  if (sections.performance || sections.pixels) {
    const trustScores = [sections.performance?.bestPractices.score, sections.pixels?.score].filter(
      (s): s is number => s !== undefined,
    );
    const trustSectionScore = Math.round(trustScores.reduce((a, b) => a + b, 0) / trustScores.length);
    sectionDefs.push({
      id: "trust",
      label: "Trust & Privacy",
      category: "theme",
      render: (n) => (
        <ReportSection id="trust" number={n} title="Trust & Privacy" action={<GradePill score={trustSectionScore} />}>
          {trustFindings.length === 0 ? (
            <FindingCard
              finding={{ id: "trust-good", title: "No trust or privacy issues found", severity: "good", description: "Best-practices audits and pixel/consent checks all passed." }}
            />
          ) : (
            <div className="space-y-4 mb-5">
              {trustFindings.map((f) => (
                <FindingCard key={f.id} finding={f} />
              ))}
            </div>
          )}
          {sections.performance && (
            <div className="mt-6">
              <div className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider mb-3">
                Console Errors
              </div>
              {consoleErrorFindingsList.length === 0 ? (
                <FindingCard
                  finding={{
                    id: "console-good",
                    title: "No console errors detected",
                    severity: "good",
                    description: "Nothing was logged to the browser console during the homepage (mobile) run.",
                  }}
                />
              ) : (
                <div className="space-y-4">
                  {consoleErrorFindingsList.map((f) => (
                    <FindingCard key={f.id} finding={f} />
                  ))}
                </div>
              )}
            </div>
          )}
          {sections.pixels && (
            <div className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden mt-5">
              <div className="px-5 py-2 bg-[#fafafa] text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider">
                Marketing pixel detail
              </div>
              <PixelAudit
                platforms={sections.pixels.platforms}
                consentMechanismDetected={sections.pixels.consentMechanismDetected}
                findings={sections.pixels.findings}
                hideFindings
              />
            </div>
          )}
        </ReportSection>
      ),
    });
  }

  if (sections.code) {
    const code = sections.code;
    sectionDefs.push({
      id: "theme-code",
      label: "Theme Code",
      category: "theme",
      render: (n) => (
        <ReportSection
          id="theme-code"
          number={n}
          title="Theme Code Quality"
          action={
            <div className="flex items-center gap-3">
              <span className="text-sm text-[#6B6B6B]">
                {code.filesScanned} files · {code.errorCount} errors · {code.warningCount} warnings
              </span>
              <GradePill score={code.score} />
            </div>
          }
        >
          {sections.themeArchitecture && (
            <div className="mb-6">
              <div className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider mb-3">
                How This Theme Is Built
              </div>
              <p className="text-sm text-[#1A1A1A] leading-relaxed mb-5">{sections.themeArchitecture.summary}</p>

              {sections.themeArchitecture.modernPractices.length > 0 && (
                <div className="mb-5">
                  <div className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider mb-3">
                    Shopify Platform Fit &amp; Modern Feature Adoption
                  </div>
                  <div className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden">
                    <BestPracticesTable rows={sections.themeArchitecture.modernPractices} />
                  </div>
                </div>
              )}

              <div className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider mb-3">
                Other Concerns
              </div>
              {themeConcernFindingsList.length === 0 ? (
                <FindingCard
                  finding={{
                    id: "theme-concern-good",
                    title: "No other architectural concerns found",
                    severity: "good",
                    description: "No concerns beyond the raw lint issues below were identified.",
                  }}
                />
              ) : (
                <div className="space-y-4">
                  {themeConcernFindingsList.map((f) => (
                    <FindingCard key={f.id} finding={f} />
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider mb-3">
            Theme Check Issues
          </div>
          <div className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden">
            <IssueTable issues={code.issues} />
          </div>
        </ReportSection>
      ),
    });
  }

  if (sections.themeStructure) {
    const themeStructure = sections.themeStructure;
    sectionDefs.push({
      id: "theme-structure",
      label: "Theme Structure",
      category: "theme",
      render: (n) => (
        <ReportSection
          id="theme-structure"
          number={n}
          title="Theme Structure"
          action={<GradePill score={themeStructure.score} />}
        >
          <div className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden">
            <ThemeStructure section={themeStructure} />
          </div>
        </ReportSection>
      ),
    });
  }

  if (sections.bestPractices && sections.bestPractices.rows.length > 0) {
    const bestPractices = sections.bestPractices;
    const verdictWeight: Record<string, number> = { good: 100, "needs-improvement": 55, poor: 0 };
    const bestPracticesScore = Math.round(
      bestPractices.rows.reduce((sum, r) => sum + verdictWeight[r.verdict], 0) / bestPractices.rows.length,
    );
    sectionDefs.push({
      id: "best-practices",
      label: "Best Practices",
      category: "theme",
      render: (n) => (
        <ReportSection id="best-practices" number={n} title="Shopify Best Practices Verdict" action={<GradePill score={bestPracticesScore} />}>
          <div className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden">
            <BestPracticesTable rows={bestPractices.rows} />
          </div>
        </ReportSection>
      ),
    });
  }

  if (aiA11ySuggestions.length > 0) {
    sectionDefs.push({
      id: "ai-suggestions-accessibility",
      label: "AI Accessibility Suggestions",
      category: "ada",
      render: (n) => (
        <ReportSection id="ai-suggestions-accessibility" number={n} title="AI Accessibility Suggestions">
          <p className="text-sm text-[#6B6B6B] mb-5 max-w-[720px]">
            Claude-generated, prioritized accessibility (ADA/WCAG) fixes grounded in the Lighthouse signals above
            and — when theme source code was available — the actual theme files. Advisory only; not part of any
            score.
          </p>
          <div className="space-y-4">
            {aiSuggestionFindings(aiA11ySuggestions).map((f) => (
              <FindingCard key={f.id} finding={f} />
            ))}
          </div>
        </ReportSection>
      ),
    });
  }

  if (sections.competitors && sections.competitors.competitors.length > 0 && sections.performance && sections.health) {
    const competitors = sections.competitors.competitors;
    const client = {
      name: report.storeName,
      performance: sections.performance.performance.score,
      accessibility: sections.performance.accessibility.score,
      bestPractices: sections.performance.bestPractices.score,
      seo: sections.performance.seo.score,
      healthScore: sections.health.score,
      screenshotPath: sections.performance.screenshotPath,
    };
    sectionDefs.push({
      id: "competitors",
      label: "Competitor Benchmark",
      category: "overview",
      render: (n) => (
        <ReportSection id="competitors" number={n} title="Competitor Benchmark">
          <p className="text-sm text-[#6B6B6B] mb-5 max-w-[720px]">
            A single mobile Lighthouse pass on each competitor's homepage, compared against this site's own scores
            above.
          </p>
          <CompetitorComparison client={client} competitors={competitors} />
        </ReportSection>
      ),
    });
  }

  sectionDefs.push({
    id: "roadmap",
    label: "Roadmap",
    category: "overview",
    render: (n) => (
      <ReportSection
        id="roadmap"
        number={n}
        title="Prioritized Roadmap"
        action={
          <Link
            href={`/reports/${report.storeSlug}/${report.id}/dev-todo`}
            className="text-sm font-medium text-[#1A1A1A] bg-[#f0efed] hover:bg-[#EDECE8] px-3.5 py-2 rounded-lg transition-colors whitespace-nowrap"
          >
            Full dev to-do list →
          </Link>
        }
      >
        <p className="text-sm text-[#6B6B6B] mb-5 max-w-[720px]">
          Ordered by severity across every section in this report — the top rows are the highest-leverage starting
          point, regardless of which category they came from. For the complete list, formatted to copy straight into
          a ticket or message, see the full dev to-do list.
        </p>
        <div className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden">
          <RoadmapTable items={roadmap} />
        </div>
      </ReportSection>
    ),
  });

  return sectionDefs;
}
