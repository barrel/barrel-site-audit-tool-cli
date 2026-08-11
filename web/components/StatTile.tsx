import { colorForScore } from "@/lib/shared";

export function StatTile({ label, score }: { label: string; score: number }) {
  const color = colorForScore(score);
  return (
    <div className="flex-1 min-w-[140px] px-5 py-4">
      <div className="text-xs font-medium text-[#9A9A9A] tracking-wide uppercase">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight" style={{ color }}>
        {score}
      </div>
    </div>
  );
}
