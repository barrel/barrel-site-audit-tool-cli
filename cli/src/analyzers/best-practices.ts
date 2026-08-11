import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  BestPracticeRow,
  BestPracticesSection,
  BestPracticeVerdict,
  CodeSection,
  PerformanceSection,
  ThemeStructureSection,
} from "@barrel/site-audit-shared";

function verdictFromScore(score: number): BestPracticeVerdict {
  if (score >= 85) return "good";
  if (score >= 60) return "needs-improvement";
  return "poor";
}

export function deriveBestPractices({
  code,
  performance,
  themeStructure,
  themeDir,
}: {
  code?: CodeSection;
  performance?: PerformanceSection;
  themeStructure?: ThemeStructureSection;
  themeDir?: string;
}): BestPracticesSection | null {
  if (!code && !performance && !themeStructure) return null;

  const rows: BestPracticeRow[] = [];

  if (code) {
    const deprecatedIssues = code.issues.filter((i) => /deprecat|legacy/i.test(i.check));
    rows.push({
      dimension: "Deprecated Liquid patterns",
      verdict: deprecatedIssues.length > 0 ? "needs-improvement" : "good",
      evidence:
        deprecatedIssues.length > 0
          ? `${deprecatedIssues.length} deprecated-pattern warning(s) found by theme-check.`
          : "No deprecated Liquid patterns flagged by theme-check.",
    });
  }

  if (performance) {
    rows.push({
      dimension: "Performance",
      verdict: verdictFromScore(performance.performance.score),
      evidence: `Lighthouse performance score: ${performance.performance.score}/100.`,
    });
    rows.push({
      dimension: "Accessibility",
      verdict: verdictFromScore(performance.accessibility.score),
      evidence: `Lighthouse accessibility score: ${performance.accessibility.score}/100.`,
    });
  }

  if (themeStructure) {
    rows.push({
      dimension: "Theme structure & hygiene",
      verdict: verdictFromScore(themeStructure.score),
      evidence: `${themeStructure.redFlags.length} structural issue(s) found (orphaned files, leftover test templates, competing page-builder apps).`,
    });
    rows.push({
      dimension: "Page-builder app usage",
      verdict: themeStructure.pageBuilderApps.length > 1 ? "needs-improvement" : "good",
      evidence:
        themeStructure.pageBuilderApps.length > 1
          ? `${themeStructure.pageBuilderApps.length} competing apps: ${themeStructure.pageBuilderApps.join(", ")}.`
          : themeStructure.pageBuilderApps.length === 1
            ? `Single page-builder app in use: ${themeStructure.pageBuilderApps[0]}.`
            : "No page-builder app signatures detected.",
    });
  }

  if (code && themeDir) {
    const hasThemeCheckConfig = existsSync(join(themeDir, ".theme-check.yml"));
    rows.push({
      dimension: "Lint / CI enforcement",
      verdict: hasThemeCheckConfig ? "needs-improvement" : "poor",
      evidence: hasThemeCheckConfig
        ? "A .theme-check.yml config is present, but no CI enforcement was detected as part of this audit."
        : "No .theme-check.yml found and no CI-based lint enforcement detected — recommend adding a pre-commit or CI lint step.",
    });
  }

  return { rows };
}
