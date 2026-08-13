import type { SitespeedMetric } from "@/lib/shared";

function formatValue(m: SitespeedMetric): string {
  if (m.unit === "ms" && m.value >= 1000) return `${(m.value / 1000).toFixed(2)}s`;
  return m.unit ? `${m.value.toLocaleString()}${m.unit === "ms" ? "ms" : ` ${m.unit}`}` : m.value.toLocaleString();
}

export function SitespeedMetrics({ metrics }: { metrics: SitespeedMetric[] }) {
  if (metrics.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-x-8 gap-y-3 bg-white border border-[#E5E5E5] rounded-lg px-5 py-4">
      {metrics.map((m) => (
        <div key={m.label}>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[#9A9A9A] mb-1">{m.label}</div>
          <div className="text-sm font-semibold tabular-nums text-[#1A1A1A]">{formatValue(m)}</div>
        </div>
      ))}
    </div>
  );
}
