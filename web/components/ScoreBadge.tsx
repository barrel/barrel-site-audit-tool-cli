import { colorForScore, gradeForScore } from "@/lib/shared";

const SIZE_CONFIG = {
  sm: { box: 36, stroke: 3.5, text: "text-xs" },
  md: { box: 56, stroke: 4.5, text: "text-lg" },
  lg: { box: 80, stroke: 5.5, text: "text-2xl" },
} as const;

/** A Lighthouse-style circular gauge — the arc fill communicates the score at a glance, not
 * just a flat color tint, and the stroke color matches colorForScore's 5-band grade palette. */
export function ScoreBadge({ score, size = "md" }: { score: number; size?: keyof typeof SIZE_CONFIG }) {
  const color = colorForScore(score);
  const { box, stroke, text } = SIZE_CONFIG[size];
  const center = box / 2;
  const radius = center - stroke / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(100, Math.max(0, score));
  const offset = circumference * (1 - clamped / 100);

  return (
    <div className="relative shrink-0" style={{ width: box, height: box }}>
      <svg width={box} height={box} viewBox={`0 0 ${box} ${box}`} className="block -rotate-90">
        <circle cx={center} cy={center} r={radius} fill="none" stroke="#E5E5E5" strokeWidth={stroke} />
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className={`absolute inset-0 flex items-center justify-center font-semibold tabular-nums ${text}`} style={{ color }}>
        {Math.round(score)}
      </div>
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
