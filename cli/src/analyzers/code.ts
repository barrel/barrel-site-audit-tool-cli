import { existsSync, readdirSync } from "node:fs";
import type { CodeIssue, CodeSection, Severity } from "@barrel/site-audit-shared";

const SEVERITY_MAP: Record<number, Severity> = {
  0: "error",
  1: "warning",
  2: "info",
};

export function themeDirHasContent(themeDir: string): boolean {
  return existsSync(themeDir) && readdirSync(themeDir).length > 0;
}

/** "MissingTemplate" -> "missing-template", to build a link into Shopify's Theme Check rule docs. */
function kebabCase(ruleName: string): string {
  return ruleName.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

function recommendationFor(issue: Pick<CodeIssue, "check" | "file" | "line">): string {
  const docsUrl = `https://shopify.dev/docs/storefronts/themes/tools/theme-check/checks/${kebabCase(issue.check)}`;
  const location = `${issue.file}${issue.line ? `:${issue.line}` : ""}`;
  return `Fix the "${issue.check}" violation at ${location} per Shopify's Theme Check rule docs: ${docsUrl}`;
}

export async function analyzeCode(themeDir: string): Promise<CodeSection | null> {
  if (!themeDirHasContent(themeDir)) return null;

  const { check } = await import("@shopify/theme-check-node");
  const offenses = await check(themeDir);

  const issues: CodeIssue[] = [];
  const filesSeen = new Set<string>();
  let errorCount = 0;
  let warningCount = 0;
  let infoCount = 0;

  for (const offense of offenses as any[]) {
    const severity = SEVERITY_MAP[offense.severity] ?? "info";
    if (severity === "error") errorCount++;
    else if (severity === "warning") warningCount++;
    else infoCount++;

    const file = offense.uri ? String(offense.uri).replace(`file://${themeDir}/`, "") : "unknown";
    filesSeen.add(file);

    const issue: CodeIssue = {
      severity,
      check: offense.check ?? "unknown",
      message: offense.message ?? "",
      file,
      line: offense.start?.line,
    };
    issue.recommendation = recommendationFor(issue);
    issues.push(issue);
  }

  // Weighted score: errors hurt most, warnings less, info least. Floors at 0.
  const penalty = errorCount * 6 + warningCount * 2 + infoCount * 0.5;
  const score = Math.max(0, Math.round(100 - penalty));

  return {
    score,
    filesScanned: filesSeen.size,
    errorCount,
    warningCount,
    infoCount,
    issues: issues.sort((a, b) => {
      const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
      return order[a.severity] - order[b.severity];
    }),
  };
}
