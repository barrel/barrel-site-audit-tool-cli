export type Grade = "A" | "B" | "C" | "D" | "F";

export function gradeForScore(score: number): Grade {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 50) return "D";
  return "F";
}

// Five-band palette matching gradeForScore's own cutoffs 1:1 (A/B/C/D/F), so a score's color and
// letter grade are always in visual agreement — red (worst) through green (best), no blue (blue
// is reserved elsewhere in the UI for "medium severity", a different signal than a grade).
export function colorForScore(score: number): string {
  if (score >= 90) return "#10B981"; // A
  if (score >= 80) return "#65A30D"; // B
  if (score >= 70) return "#D97706"; // C
  if (score >= 50) return "#EA580C"; // D
  return "#B91C1C"; // F
}

export function average(scores: number[]): number {
  const valid = scores.filter((s) => Number.isFinite(s));
  if (valid.length === 0) return 0;
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
}

export type ComplianceBand = "at-risk" | "improving" | "healthy";

/** Bands for the compliance scores, which do not use the A-F scale the Lighthouse-derived
 * numbers do.
 *
 * Two reasons they need their own scale. The compliance scores are a weighted proportion of what
 * was confirmed rather than a percentage of a fixed total, so a 40 there is not the same claim as
 * a Lighthouse 40. And any confirmed top-severity failure scales the result into the bottom half
 * by design, which means a site with one unresolved blocker mathematically cannot reach green —
 * that is the intended reading, not a quirk: nothing that leaks data after an opt-out should
 * present as healthy.
 *
 * The cutoffs are deliberately reachable. Full marks is not a realistic target for a live
 * storefront with a working marketing stack, and a scale where everything is red teaches people
 * to ignore it. */
export function complianceBand(score: number): ComplianceBand {
  if (score >= 60) return "healthy";
  if (score >= 30) return "improving";
  return "at-risk";
}

export function colorForComplianceScore(score: number): string {
  const band = complianceBand(score);
  return band === "healthy" ? "#10B981" : band === "improving" ? "#D97706" : "#B91C1C";
}

export const COMPLIANCE_BAND_LABEL: Record<ComplianceBand, string> = {
  healthy: "Healthy",
  improving: "Improving",
  "at-risk": "At risk",
};
