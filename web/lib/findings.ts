import type { AiSuggestion, AxeImpact, AxePageResult, HealthCheckItem, LighthouseCategoryResult, PixelFinding, SeoOpportunity, UxOpportunity } from "./shared";
import { stripMarkdownLinks, extractMarkdownLinkUrl } from "./format";

export type FindingSeverity = "critical" | "high" | "medium" | "low" | "good";

export interface Finding {
  id: string;
  title: string;
  severity: FindingSeverity;
  description: string;
  displayValue?: string;
  /** Where this finding applies — a specific page ("Homepage", "Collection page"), a
   * specific theme file, or "Site-wide" for config/behavior that isn't tied to one page.
   * Optional since "good" (no-issue) filler findings never reach the roadmap and don't need one. */
  scope?: string;
  /** Concrete remediation instruction — what to change, and where — kept separate from
   * `description` (which explains *why* the finding matters) so a Dev To-Do item can show
   * both the rationale and the fix without merging them into a run-on sentence. */
  recommendation?: string;
  /** A concrete, AI-written corrected code snippet that implements the fix — only present for
   * AI suggestions grounded in an actual sampled theme file. */
  codeFix?: string;
}

function severityFromScore(score: number | null): FindingSeverity {
  if (score === null) return "medium";
  if (score < 0.3) return "critical";
  if (score < 0.5) return "high";
  if (score < 0.8) return "medium";
  return "low";
}

export function lighthouseFindings(category: LighthouseCategoryResult, prefix: string): Finding[] {
  return category.audits.map((audit) => {
    const learnMoreUrl = extractMarkdownLinkUrl(audit.description);
    return {
      id: `${prefix}-${audit.id}`,
      title: audit.title,
      severity: severityFromScore(audit.score),
      description: stripMarkdownLinks(audit.description),
      displayValue: audit.displayValue,
      scope: "Homepage",
      recommendation: learnMoreUrl ? `Learn more: ${learnMoreUrl}` : undefined,
    };
  });
}

export function healthFindings(checks: HealthCheckItem[]): Finding[] {
  return checks
    .filter((c) => c.status !== "pass")
    .map((c) => ({
      id: `health-${c.id}`,
      title: c.label,
      severity: c.status === "fail" ? "high" : "medium",
      description: c.detail,
      scope: "Site-wide",
      recommendation: c.recommendation,
    }));
}

export function seoOpportunityFindings(opportunities: SeoOpportunity[]): Finding[] {
  return opportunities.map((o, i) => ({
    id: `seo-opp-${i}`,
    title: o.title,
    severity: o.impact,
    description: o.detail,
    scope: "Homepage",
    recommendation: o.recommendation,
  }));
}

const AXE_IMPACT_SEVERITY: Record<AxeImpact, FindingSeverity> = {
  critical: "critical",
  serious: "high",
  moderate: "medium",
  minor: "low",
};

export function axeFindings(pages: AxePageResult[]): Finding[] {
  return pages.flatMap((p) =>
    p.violations.map((v, i) => {
      const targets = v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(", ");
      return {
        id: `axe-${p.page}-${v.id}-${i}`,
        title: `${v.help} (${p.page})`,
        severity: v.impact ? AXE_IMPACT_SEVERITY[v.impact] : "medium",
        description: `${v.description} — ${v.nodeCount} element(s) affected${targets ? `: ${targets}` : ""}.`,
        scope: `${p.page} page`,
        recommendation: `Learn more: ${v.helpUrl}`,
      };
    }),
  );
}

export function uxOpportunityFindings(opportunities: UxOpportunity[]): Finding[] {
  return opportunities.map((o, i) => ({
    id: `ux-opp-${i}`,
    title: `${o.title} (${o.page})`,
    severity: o.impact,
    description: o.detail,
    scope: `${o.page} page`,
    recommendation: o.recommendation,
  }));
}

export function aiSuggestionFindings(suggestions: AiSuggestion[]): Finding[] {
  return suggestions.map((s, i) => ({
    id: `ai-suggestion-${i}`,
    title: s.file ? `${s.title} (${s.file})` : s.title,
    severity: s.severity,
    description: s.detail,
    scope: s.file ? `Theme file: ${s.file}` : "Homepage",
    recommendation: s.recommendation,
    codeFix: s.codeFix,
  }));
}

export function pixelToFindings(findings: PixelFinding[]): Finding[] {
  return findings.map((f, i) => ({
    id: `pixel-${i}`,
    title: f.title,
    severity: f.severity === "error" ? "critical" : f.severity === "warning" ? "high" : "low",
    description: f.detail,
    scope: "Site-wide",
    recommendation: f.recommendation,
  }));
}

const SEVERITY_RANK: Record<FindingSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3, good: 4 };

export interface RoadmapItem {
  priority: number;
  fix: string;
  why: string;
  effort: "Trivial" | "Small" | "Medium" | "Large";
  severity: FindingSeverity;
  category: string;
  scope: string;
  /** Concrete instruction for how to resolve this item — what to change and where. */
  recommendation?: string;
  codeFix?: string;
}

function effortForFinding(f: Finding): RoadmapItem["effort"] {
  if (/lazy|alt text|contrast|meta description|title tag|canonical|robots\.txt|sitemap/i.test(f.title)) {
    return "Trivial";
  }
  if (/third-party|script|consent|structured data|orphaned|deprecated/i.test(f.title)) {
    return "Medium";
  }
  return "Small";
}

// Ordered most-specific-prefix-first so e.g. "seo-opp-" matches before "seo-".
const CATEGORY_PREFIXES: [string, string][] = [
  ["seo-opp-", "SEO Opportunities"],
  ["ux-opp-", "UX & Conversion"],
  ["ai-suggestion-", "AI Suggestions"],
  ["perf-", "Performance"],
  ["a11y-", "Accessibility"],
  ["axe-", "Accessibility (Axe)"],
  ["seo-", "Technical & SEO"],
  ["health-", "Site Health"],
  ["pixel-", "Trust & Privacy"],
  ["bp-", "Trust & Privacy"],
  ["theme-", "Theme Structure"],
  ["code-", "Theme Code"],
];

function categoryForFinding(f: Finding): string {
  return CATEGORY_PREFIXES.find(([prefix]) => f.id.startsWith(prefix))?.[1] ?? "General";
}

// Theme Check rules that are near-always noise (e.g. MatchingTranslations flags any locale
// key drift, even trivial/intentional ones) — too low-signal to hand a developer as a to-do.
// Still shown in the raw Theme Code section; just excluded from the prioritized roadmap.
const NOISY_CODE_CHECKS = new Set(["MatchingTranslations"]);

function isNoisyCodeFinding(f: Finding): boolean {
  return f.id.startsWith("code-") && NOISY_CODE_CHECKS.has(f.title);
}

export function buildRoadmap(allFindings: Finding[], limit = 10): RoadmapItem[] {
  const actionable = allFindings.filter((f) => f.severity !== "good" && !isNoisyCodeFinding(f));
  const sorted = [...actionable].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  return sorted.slice(0, limit).map((f, i) => ({
    priority: i + 1,
    fix: f.title,
    why: f.description,
    effort: effortForFinding(f),
    severity: f.severity,
    category: categoryForFinding(f),
    scope: f.scope ?? "Site-wide",
    recommendation: f.recommendation,
    codeFix: f.codeFix,
  }));
}

/** Every actionable finding across the whole report, priority-ordered — unlike
 * buildRoadmap (capped at 10, for the Overview page teaser), this is the full list meant
 * for handing off to a developer. */
export function buildDevTodo(allFindings: Finding[]): RoadmapItem[] {
  return buildRoadmap(allFindings, allFindings.length);
}

/** Renders a dev to-do list as plain-text/Markdown, one self-contained ticket block per item
 * (Summary + Description, separated by "---"), so each block can be pasted directly into a
 * Jira issue — Summary into the title field, Description into the description field — without
 * relying on nested-list indentation rendering correctly in every destination. */
export function formatDevTodoMarkdown(
  report: { storeName: string; storeUrl: string; createdAt: string },
  items: RoadmapItem[],
): string {
  const date = new Date(report.createdAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const header = [`Dev To-Do — ${report.storeName}`, `${report.storeUrl} · Audit generated ${date}`];
  if (items.length === 0) {
    return [...header, "", "No outstanding issues to prioritize — nice work."].join("\n");
  }
  const blocks = items.map((item) => {
    const lines = [
      `Summary: [P${item.priority} · ${item.severity.toUpperCase()}] ${item.fix} — ${item.scope}`,
      "Description:",
      `Category: ${item.category}  ·  Effort: ${item.effort}  ·  Severity: ${item.severity}`,
      "",
      `Why it matters: ${item.why}`,
    ];
    lines.push("", `How to fix: ${item.recommendation ?? "No specific remediation captured — use judgment based on the finding above."}`);
    if (item.codeFix) {
      lines.push("", "Code fix:", "```", ...item.codeFix.split("\n"), "```");
    }
    return lines.join("\n");
  });
  return [...header, "", blocks.join("\n\n---\n\n")].join("\n");
}
