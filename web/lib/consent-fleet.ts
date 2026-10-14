import type { ConsentFleetReport, ConsentFleetRow, ConsentTestResult } from "./shared";
import { COMPLIANCE_BAND_LABEL, complianceBand } from "./shared";

/** Worst first. A fleet view sorted any other way buries the one site that needs attention
 * behind twenty that don't. */
export function rank(row: ConsentFleetRow): number {
  if (row.totals.blockers > 0) return 0;
  if (row.status === "issues") return 1;
  if (row.status === "error") return 2;
  if (row.status === "blocked") return 3;
  return 4;
}

export function sortFleetRows(rows: ConsentFleetRow[]): ConsentFleetRow[] {
  return [...rows].sort((a, b) => rank(a) - rank(b) || b.totals.blockers - a.totals.blockers);
}

export interface SharedFix {
  id: string;
  title: string;
  severity: ConsentTestResult["severity"];
  recommendation?: string;
  sites: string[];
}

const SEVERITY_ORDER: Record<ConsentTestResult["severity"], number> = { blocker: 0, error: 1, warning: 2, info: 3 };

/** One remediation, and every site that needs it.
 *
 * The fleet table answers "which site is worst"; this answers "what should we actually do",
 * which is a different question and usually the one being asked. Six sites failing C4 is one
 * afternoon of work, not six — and nothing in a per-site view makes that visible.
 *
 * `minSites` is 2 on the dashboard, where a single-site failure is already visible in the row.
 * The shareable report passes 1: someone reading it without the dashboard has no row to look at,
 * so every failure needs to appear somewhere. */
export function sharedFixes(rows: ConsentFleetRow[], minSites = 2): SharedFix[] {
  const byTest = new Map<string, SharedFix>();
  for (const row of rows) {
    for (const t of row.failedTests) {
      if (t.status === "flaky") continue;
      const entry = byTest.get(t.id) ?? {
        id: t.id,
        title: t.title,
        severity: t.severity,
        recommendation: t.recommendation,
        sites: [],
      };
      entry.recommendation ??= t.recommendation;
      entry.sites.push(row.client);
      byTest.set(t.id, entry);
    }
  }
  return [...byTest.values()]
    .filter((f) => f.sites.length >= minSites)
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.sites.length - a.sites.length);
}

export interface FleetSummary {
  /** Sites that produced a score — the denominator for the average, never the whole fleet. */
  scored: number;
  notScored: number;
  /** Mean of the scored sites only. Null when none were scored. A site with no score is not a zero. */
  averageScore: number | null;
  medianScore: number | null;
  bands: Record<"healthy" | "improving" | "at-risk", number>;
  sitesWithBlockers: number;
  totalBlockers: number;
}

export function summarizeFleet(rows: ConsentFleetRow[]): FleetSummary {
  const scores = rows.map((r) => r.score).filter((s): s is number => s !== null);
  const sorted = [...scores].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length === 0 ? null : sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  const bands = { healthy: 0, improving: 0, "at-risk": 0 };
  for (const s of scores) bands[complianceBand(s)] += 1;
  return {
    scored: scores.length,
    notScored: rows.length - scores.length,
    averageScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
    medianScore: median,
    bands,
    sitesWithBlockers: rows.filter((r) => r.totals.blockers > 0).length,
    totalBlockers: rows.reduce((sum, r) => sum + r.totals.blockers, 0),
  };
}

/** RFC 4180, every field quoted — same reasoning as consent-inventory-csv: failure details contain
 * commas and newlines, and one unquoted comma silently shifts every later column. */
function cell(value: string | number | undefined | null): string {
  const s = value === undefined || value === null ? "" : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

const STATUS_LABEL = { ok: "Clean", issues: "Issues", blocked: "Blocked", error: "Unreachable" } as const;

/** One row per site — the spreadsheet version of the fleet table. */
export function fleetToCsv(report: ConsentFleetReport): string {
  const header = [
    "Client",
    "URL",
    "CMP",
    "Status",
    "Score",
    "Band",
    "Blockers",
    "Passed",
    "Failed",
    "Not applicable",
    "Blocked (untested)",
    "Flaky",
    "Failed tests",
    "Error",
  ];
  const lines = [header.map(cell).join(",")];
  for (const row of sortFleetRows(report.rows)) {
    lines.push(
      [
        row.client,
        row.url,
        row.cmp,
        STATUS_LABEL[row.status],
        row.score === null ? "not scored" : row.score,
        row.score === null ? "" : COMPLIANCE_BAND_LABEL[complianceBand(row.score)],
        row.totals.blockers,
        row.totals.pass,
        row.totals.fail,
        row.totals.skipped,
        row.totals.blocked,
        row.totals.flaky,
        row.failedTests.map((t) => `${t.id} ${t.title}${t.status === "flaky" ? " (flaky)" : ""}`).join("; "),
        row.error ?? "",
      ]
        .map(cell)
        .join(","),
    );
  }
  return lines.join("\r\n");
}
