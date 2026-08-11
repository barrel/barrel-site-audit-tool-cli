import { colorForScore, gradeForScore } from "@/lib/shared";

export function ScoreBadge({ score, size = "md" }: { score: number; size?: "sm" | "md" | "lg" }) {
  const color = colorForScore(score);
  const dims = size === "lg" ? "w-20 h-20 text-2xl" : size === "sm" ? "w-9 h-9 text-xs" : "w-14 h-14 text-lg";

  return (
    <div
      className={`${dims} rounded-full flex items-center justify-center font-semibold shrink-0`}
      style={{ backgroundColor: `${color}1A`, color }}
    >
      {score}
    </div>
  );
}

export function GradePill({ score }: { score: number }) {
  const color = colorForScore(score);
  const grade = gradeForScore(score);
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold"
      style={{ backgroundColor: `${color}1A`, color }}
    >
      {grade}
    </span>
  );
}
