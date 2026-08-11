import type { CoreWebVitals, VitalMetric } from "@/lib/shared";

const VITAL_LABELS: Record<keyof CoreWebVitals, string> = {
  lcp: "LCP",
  cls: "CLS",
  tbt: "TBT",
  fcp: "FCP",
  speedIndex: "Speed Index",
};

function bandColor(score: number | null): string {
  if (score === null) return "#6B6B6B";
  if (score >= 0.9) return "#10B981";
  if (score >= 0.5) return "#D97706";
  return "#B91C1C";
}

export function CoreWebVitalsTable({ vitals }: { vitals: CoreWebVitals }) {
  const entries = (Object.keys(VITAL_LABELS) as (keyof CoreWebVitals)[])
    .map((key) => ({ key, label: VITAL_LABELS[key], metric: vitals[key] }))
    .filter((e): e is { key: keyof CoreWebVitals; label: string; metric: VitalMetric } => Boolean(e.metric));

  if (entries.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-x-8 gap-y-3 bg-white border border-[#E5E5E5] rounded-lg px-5 py-4">
      {entries.map((e) => {
        const color = bandColor(e.metric.score);
        return (
          <div key={e.key}>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[#9A9A9A] mb-1">{e.label}</div>
            <div className="inline-flex items-center gap-1.5 text-sm font-semibold tabular-nums" style={{ color }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
              {e.metric.displayValue}
            </div>
          </div>
        );
      })}
    </div>
  );
}
