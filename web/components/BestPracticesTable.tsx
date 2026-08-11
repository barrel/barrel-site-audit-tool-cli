import type { BestPracticeRow, BestPracticeVerdict } from "@/lib/shared";

const VERDICT_COLOR: Record<BestPracticeVerdict, string> = {
  good: "#10B981",
  "needs-improvement": "#D97706",
  poor: "#B91C1C",
};

const VERDICT_LABEL: Record<BestPracticeVerdict, string> = {
  good: "Good",
  "needs-improvement": "Needs improvement",
  poor: "Poor",
};

export function BestPracticesTable({ rows }: { rows: BestPracticeRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: "220px" }} />
          <col style={{ width: "160px" }} />
          <col />
        </colgroup>
        <thead>
          <tr className="bg-[#fafafa] text-left">
            <th className="px-5 py-2 text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider">Dimension</th>
            <th className="px-5 py-2 text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider">Verdict</th>
            <th className="px-5 py-2 text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider">Evidence</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#E5E5E5]">
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-[#fafafa]">
              <td className="px-5 py-3 align-top font-medium text-[#1A1A1A]">{row.dimension}</td>
              <td className="px-5 py-3 align-top">
                <span
                  className="inline-flex items-center gap-1.5 text-xs font-semibold"
                  style={{ color: VERDICT_COLOR[row.verdict] }}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: VERDICT_COLOR[row.verdict] }} />
                  {VERDICT_LABEL[row.verdict]}
                </span>
              </td>
              <td className="px-5 py-3 align-top text-[#6B6B6B]">{row.evidence}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
