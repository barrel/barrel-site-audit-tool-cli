import { colorForScore } from "@/lib/shared";

export interface DeviceScores {
  performance: number;
  accessibility: number;
  bestPractices: number;
  seo: number;
}

const METRICS: { key: keyof DeviceScores; label: string }[] = [
  { key: "performance", label: "Performance" },
  { key: "accessibility", label: "Accessibility" },
  { key: "bestPractices", label: "Best Practices" },
  { key: "seo", label: "SEO" },
];

/** Mobile vs. desktop Lighthouse scores for one page, side by side — a compact comparison
 * table rather than two separate meter rows, so the two form factors read at a glance. */
export function DeviceScoreComparison({ mobile, desktop }: { mobile: DeviceScores; desktop?: DeviceScores }) {
  return (
    <div className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden">
      <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
        <colgroup>
          <col />
          <col style={{ width: "140px" }} />
          {desktop && <col style={{ width: "140px" }} />}
        </colgroup>
        <thead>
          <tr className="bg-[#fafafa] text-left">
            <th className="px-5 py-2 text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider">Metric</th>
            <th className="px-5 py-2 text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider">Mobile</th>
            {desktop && (
              <th className="px-5 py-2 text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider">Desktop</th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#E5E5E5]">
          {METRICS.map((m) => (
            <tr key={m.key}>
              <td className="px-5 py-3 font-medium text-[#1A1A1A]">{m.label}</td>
              <td className="px-5 py-3 tabular-nums font-semibold" style={{ color: colorForScore(mobile[m.key]) }}>
                {mobile[m.key]}
              </td>
              {desktop && (
                <td className="px-5 py-3 tabular-nums font-semibold" style={{ color: colorForScore(desktop[m.key]) }}>
                  {desktop[m.key]}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
