import type { SummarySection } from "@/lib/shared";

export function Summary({ summary }: { summary: SummarySection }) {
  return (
    <section className="bg-white border border-[#E5E5E5] rounded-lg overflow-hidden">
      <div className="px-5 py-4 border-b border-[#E5E5E5]">
        <h2 className="text-lg font-semibold text-[#000000] tracking-tight">The Big Picture</h2>
      </div>
      <div className="px-5 py-4">
        <p className="text-sm text-[#1A1A1A] leading-relaxed">{summary.overview}</p>
        {summary.keyFindings.length > 0 && (
          <>
            <div className="text-[10px] font-semibold text-[#9A9A9A] uppercase tracking-wider mt-4 mb-2">
              Key findings
            </div>
            <ul className="space-y-1.5">
              {summary.keyFindings.map((finding, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-[#1A1A1A]">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#1A1A1A]/40 shrink-0" />
                  {finding}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
