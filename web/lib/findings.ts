import type { AdaScopeItem, AdaScopeSection, AdaScopeStatus, AiSuggestion, AxeImpact, AxePageResult, ConsentSection, ConsentTestResult, ConsoleErrorItem, HealthCheckItem, LighthouseCategoryResult, PixelFinding, SecuritySection, SecuritySeverity, SeoOpportunity, SitespeedAdvice, ThemeConcern, UxOpportunity } from "./shared";
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
  /** Theme file this finding applies to, relative to the theme root (e.g. "sections/hero.liquid")
   * — only set for findings grounded in an actual sampled/linted theme file. Drives eligibility
   * for the "Suggest fix" action, since that flow needs a real file to read and patch. */
  file?: string;
  /** 1-based line number within `file`, when known (Theme Check offenses only). */
  line?: number;
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

const ADA_SCOPE_SEVERITY: Record<AdaScopeStatus, FindingSeverity> = {
  incomplete: "high",
  partial: "medium",
  manual: "low",
  unverified: "low",
  complete: "good",
};

function adaScopeTitle(item: AdaScopeItem): string {
  const text = item.text.length > 110 ? `${item.text.slice(0, 107)}...` : item.text;
  return `Scoped ADA item: ${text}`;
}

/** Turns every ADA scope item that isn't verified complete into a roadmap/dev-to-do finding, so a
 * contractual accessibility commitment lands in the same prioritized list as everything else
 * rather than living only inside its own section. "unverified" items are excluded — those need the
 * audit re-run with the axe scan enabled, which is a task for whoever runs the tool, not the
 * client's developer. */
export function adaScopeFindings(section: AdaScopeSection): Finding[] {
  return section.items
    .filter((i) => i.status === "incomplete" || i.status === "partial" || i.status === "manual")
    .map((item) => ({
      id: `ada-scope-${item.id}`,
      title: adaScopeTitle(item),
      severity: ADA_SCOPE_SEVERITY[item.status],
      description:
        item.evidence.map((e) => `${e.source}${e.page ? ` (${e.page})` : ""}: ${e.detail}`).join(" ") ||
        "No automated check in this audit covers this scope item.",
      scope:
        item.status === "manual"
          ? "Manual QA"
          : section.pagesScanned.length > 0
            ? `${section.pagesScanned.join(", ")} page(s)`
            : "Site-wide",
      recommendation: item.action,
    }));
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

const CONSOLE_ERROR_LABELS: Record<string, string> = {
  network: "Failed network request",
  security: "Security/CSP violation",
  exception: "Uncaught JavaScript exception",
};

const CONSOLE_ERROR_SEVERITY: Record<string, FindingSeverity> = {
  network: "medium",
  security: "high",
  exception: "high",
};

export function consoleErrorFindings(errors: ConsoleErrorItem[]): Finding[] {
  return errors.map((e, i) => ({
    id: `console-${i}`,
    title: CONSOLE_ERROR_LABELS[e.source] ?? "Console error",
    severity: CONSOLE_ERROR_SEVERITY[e.source] ?? "medium",
    description: e.description,
    scope: e.url ? `${e.url}${e.line ? `:${e.line}` : ""}` : "Homepage",
  }));
}

export function sitespeedAdviceFindings(advice: SitespeedAdvice[]): Finding[] {
  return advice.map((a, i) => ({
    id: `sitespeed-${i}`,
    title: `${a.title} (${a.category})`,
    severity: a.severity,
    description: a.detail,
    scope: "Homepage",
    recommendation: a.recommendation,
  }));
}

export function themeConcernFindings(concerns: ThemeConcern[]): Finding[] {
  return concerns.map((c, i) => ({
    id: `theme-concern-${i}`,
    title: c.title,
    severity: c.severity,
    description: c.detail,
    scope: "Theme architecture",
    recommendation: c.recommendation,
  }));
}

export function agentReadinessIssueFindings(issues: ThemeConcern[]): Finding[] {
  return issues.map((c, i) => ({
    id: `agent-readiness-${i}`,
    title: c.title,
    severity: c.severity,
    description: c.detail,
    scope: "Agent readiness",
    recommendation: c.recommendation,
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
    file: s.file,
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

/** Consent test failures, so they reach the Prioritized Roadmap and Dev To-Do rather than
 * living only inside their own section. Passes and skips are omitted — a roadmap is a list of
 * work, and a `blocked` result is a coverage gap to re-run, not a fix to assign. */
export function consentToFindings(section: ConsentSection): Finding[] {
  const rank: Record<ConsentTestResult["severity"], FindingSeverity> = {
    blocker: "critical",
    error: "high",
    warning: "medium",
    info: "low",
  };
  return section.tests
    .filter((t) => t.status === "fail" || t.status === "flaky")
    .map((t) => ({
      id: `consent-${t.id}`,
      title: `${t.id} · ${t.title}`,
      // A flaky result is never critical: we could not reproduce it, and putting an unconfirmed
      // finding at the top of a client roadmap is how the roadmap stops being believed.
      severity: t.status === "flaky" ? "medium" : rank[t.severity],
      description: t.detail,
      scope: "Site-wide",
      recommendation: t.recommendation,
    }));
}

/** Security failures, so they reach the Prioritized Roadmap and Dev To-Do rather than living only
 * inside their own section. `not-tested` is omitted for the same reason a `blocked` consent result
 * is: a roadmap is a list of work, and a coverage gap is something to re-run, not to assign. */
export function securityToFindings(section: SecuritySection): Finding[] {
  const rank: Record<SecuritySeverity, FindingSeverity> = {
    critical: "critical",
    high: "high",
    medium: "medium",
    low: "low",
  };
  return section.checks
    .filter((c) => c.status === "fail" || c.status === "warn")
    .map((c) => ({
      id: `security-${c.id}`,
      title: c.title,
      // A warn is a weaker-than-it-should-be control rather than an absent one, so it drops a rung
      // — otherwise a short HSTS max-age would outrank a missing CSP on the same roadmap.
      severity: c.status === "warn" ? demote(rank[c.severity]) : rank[c.severity],
      description: c.detail,
      scope: "Site-wide",
      recommendation: c.recommendation,
    }));
}

function demote(severity: FindingSeverity): FindingSeverity {
  const order: FindingSeverity[] = ["critical", "high", "medium", "low"];
  const next = order[order.indexOf(severity) + 1];
  return next ?? "low";
}

const SEVERITY_RANK: Record<FindingSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3, good: 4 };

export interface RoadmapItem {
  /** Stable id, carried over from the source Finding — used to key the "Suggest fix" flow to
   * one specific item rather than an array index/priority rank. */
  id: string;
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
  file?: string;
  line?: number;
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
  ["ada-scope-", "ADA Scope"],
  ["axe-", "Accessibility (Axe)"],
  ["sitespeed-", "Performance (Sitespeed.io)"],
  ["seo-", "Technical & SEO"],
  ["health-", "Site Health"],
  ["security-", "Security & Compliance"],
  ["pixel-", "Trust & Privacy"],
  ["bp-", "Trust & Privacy"],
  ["console-", "Trust & Privacy"],
  ["theme-concern-", "Theme Architecture"],
  ["agent-readiness-", "Agent Readiness"],
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
    id: f.id,
    priority: i + 1,
    fix: f.title,
    why: f.description,
    effort: effortForFinding(f),
    severity: f.severity,
    category: categoryForFinding(f),
    scope: f.scope ?? "Site-wide",
    recommendation: f.recommendation,
    codeFix: f.codeFix,
    file: f.file,
    line: f.line,
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
    timeZone: "America/New_York",
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

const JIRA_PRIORITY: Record<FindingSeverity, string> = {
  critical: "Highest",
  high: "High",
  medium: "Medium",
  low: "Low",
  good: "Low",
};

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

// Jira's Labels field rejects spaces/most punctuation — collapse a category like
// "SEO Opportunities" down to "seo-opportunities" so a straight CSV import doesn't choke on it.
function toJiraLabel(category: string): string {
  return category.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Renders a dev to-do list as CSV, columns matching Jira's CSV importer field names
 * (Summary, Priority, Labels, Issue Type, Description) so the file can be dragged straight into
 * Jira's "Import issues from CSV" flow instead of round-tripping through copy/paste. */
export function formatDevTodoCsv(items: RoadmapItem[]): string {
  const headers = ["Summary", "Priority", "Labels", "Issue Type", "Description"];
  const rows = items.map((item) => {
    const descriptionLines = [
      `Where: ${item.scope}`,
      `Category: ${item.category}  ·  Effort: ${item.effort}  ·  Severity: ${item.severity}`,
      "",
      `Why it matters: ${item.why}`,
      "",
      `How to fix: ${item.recommendation ?? "No specific remediation captured — use judgment based on the finding above."}`,
    ];
    if (item.codeFix) {
      descriptionLines.push("", "Code fix:", item.codeFix);
    }
    return [
      `[P${item.priority}] ${item.fix} — ${item.scope}`,
      JIRA_PRIORITY[item.severity],
      toJiraLabel(item.category),
      "Task",
      descriptionLines.join("\n"),
    ];
  });
  return [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
}
