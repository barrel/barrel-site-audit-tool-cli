export type Grade = "A" | "B" | "C" | "D" | "F";

export function gradeForScore(score: number): Grade {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 50) return "D";
  return "F";
}

// Matches Barrel's semantic color palette: green on-track, amber warning, red danger.
export function colorForScore(score: number): string {
  if (score >= 90) return "#10B981";
  if (score >= 50) return "#D97706";
  return "#B91C1C";
}

export function average(scores: number[]): number {
  const valid = scores.filter((s) => Number.isFinite(s));
  if (valid.length === 0) return 0;
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
}
