import { colorForScore, type CompetitorResult } from "@/lib/shared";
import { screenshotUrl } from "@/lib/screenshot";

interface ClientColumn {
  name: string;
  performance: number;
  accessibility: number;
  bestPractices: number;
  seo: number;
  healthScore: number;
  screenshotPath?: string;
}

const METRICS: Array<{ key: Exclude<keyof ClientColumn, "name" | "screenshotPath">; label: string }> = [
  { key: "performance", label: "Performance" },
  { key: "accessibility", label: "Accessibility" },
  { key: "bestPractices", label: "Best Practices" },
  { key: "seo", label: "SEO" },
  { key: "healthScore", label: "Site Health" },
];

function ScoreCell({ value, isBest }: { value: number; isBest: boolean }) {
  const color = colorForScore(value);
  return (
    <td className="px-4 py-3 text-center">
      <span
        className="inline-flex items-center justify-center min-w-[44px] px-2 py-1 rounded-md text-sm font-semibold tabular-nums"
        style={{ backgroundColor: isBest ? `${color}1A` : "transparent", color }}
      >
        {value}
      </span>
    </td>
  );
}

export function CompetitorComparison({
  client,
  competitors,
}: {
  client: ClientColumn;
  competitors: CompetitorResult[];
}) {
  const columns = [client, ...competitors];
  const hasScreenshots = columns.some((c) => c.screenshotPath);

  return (
    <div className="overflow-x-auto border border-[#E5E5E5] rounded-lg bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-[#fafafa] border-b border-[#E5E5E5]">
            <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider">
              Metric
            </th>
            {columns.map((c, i) => (
              <th
                key={c.name + i}
                className="px-4 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap"
              >
                <span className={i === 0 ? "text-[#1A1A1A]" : "text-[#6B6B6B]"}>
                  {i === 0 ? `${c.name} (you)` : c.name}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#E5E5E5]">
          {hasScreenshots && (
            <tr>
              <td className="px-4 py-3 text-[#1A1A1A] font-medium whitespace-nowrap align-top">Screenshot</td>
              {columns.map((c, i) => (
                <td key={i} className="px-4 py-3 text-center align-top">
                  {c.screenshotPath ? (
                    <a
                      href={screenshotUrl(c.screenshotPath)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block border border-[#E5E5E5] rounded-md overflow-hidden hover:border-[#1A1A1A]/30 transition-colors"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={screenshotUrl(c.screenshotPath)}
                        alt={`${c.name} homepage screenshot`}
                        className="w-[120px] h-auto block"
                      />
                    </a>
                  ) : (
                    <span className="text-xs text-[#D4D4D4]">—</span>
                  )}
                </td>
              ))}
            </tr>
          )}
          {METRICS.map((m) => {
            const values = columns.map((c) => c[m.key]);
            const best = Math.max(...values);
            return (
              <tr key={m.key}>
                <td className="px-4 py-3 text-[#1A1A1A] font-medium whitespace-nowrap">{m.label}</td>
                {values.map((v, i) => (
                  <ScoreCell key={i} value={v} isBest={v === best} />
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-xs text-[#9A9A9A] px-4 py-3 border-t border-[#E5E5E5]">
        Performance/Accessibility/Best Practices/SEO from a single mobile Lighthouse pass on each homepage. Highlighted
        cell marks the best score per row.
      </p>
    </div>
  );
}
