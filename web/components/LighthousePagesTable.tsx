import type { LighthousePageResult } from "@/lib/shared";
import { colorForScore } from "@/lib/shared";

function ScoreCell({ score }: { score: number }) {
  return (
    <span className="tabular-nums font-medium" style={{ color: colorForScore(score) }}>
      {score}
    </span>
  );
}

export function LighthousePagesTable({ pages }: { pages: LighthousePageResult[] }) {
  const order: string[] = [];
  const grouped = new Map<string, LighthousePageResult[]>();
  for (const p of pages) {
    if (!grouped.has(p.page)) {
      grouped.set(p.page, []);
      order.push(p.page);
    }
    grouped.get(p.page)!.push(p);
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: "20%" }} />
          <col style={{ width: "16%" }} />
          <col />
          <col />
          <col />
          <col />
        </colgroup>
        <thead>
          <tr className="bg-[#fafafa] text-left">
            <th className="px-5 py-2 text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider">Page</th>
            <th className="px-5 py-2 text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider">Device</th>
            <th className="px-5 py-2 text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider">Perf</th>
            <th className="px-5 py-2 text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider">A11y</th>
            <th className="px-5 py-2 text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider">Best Pr.</th>
            <th className="px-5 py-2 text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider">SEO</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#E5E5E5]">
          {order.flatMap((pageName) => {
            const rows = grouped.get(pageName)!;
            return rows.map((r, i) => (
              <tr key={`${pageName}-${r.device}`} className="hover:bg-[#fafafa]">
                {i === 0 && (
                  <td
                    rowSpan={rows.length}
                    className="px-5 py-3 align-top font-semibold text-[#1A1A1A] border-r border-[#E5E5E5]"
                  >
                    {pageName}
                  </td>
                )}
                <td className="px-5 py-3 text-[#6B6B6B] capitalize">{r.device}</td>
                <td className="px-5 py-3">
                  <ScoreCell score={r.performance} />
                </td>
                <td className="px-5 py-3">
                  <ScoreCell score={r.accessibility} />
                </td>
                <td className="px-5 py-3">
                  <ScoreCell score={r.bestPractices} />
                </td>
                <td className="px-5 py-3">
                  <ScoreCell score={r.seo} />
                </td>
              </tr>
            ));
          })}
        </tbody>
      </table>
    </div>
  );
}
