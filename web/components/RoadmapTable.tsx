import type { RoadmapItem } from "@/lib/findings";

const EFFORT_COLOR: Record<RoadmapItem["effort"], string> = {
  Trivial: "#10B981",
  Small: "#3B82F6",
  Medium: "#D97706",
  Large: "#B91C1C",
};

export function RoadmapTable({ items }: { items: RoadmapItem[] }) {
  if (items.length === 0) {
    return <div className="px-5 py-6 text-sm text-[#6B6B6B]">No outstanding issues to prioritize — nice work.</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: "44px" }} />
          <col style={{ width: "22%" }} />
          <col style={{ width: "150px" }} />
          <col style={{ width: "90px" }} />
          <col />
        </colgroup>
        <thead>
          <tr className="bg-[#fafafa] text-left">
            <th className="px-5 py-2 text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider">
              <span className="sr-only">Priority</span>
            </th>
            <th className="px-5 py-2 text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider">Fix</th>
            <th className="px-5 py-2 text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider">Where</th>
            <th className="px-5 py-2 text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider">Effort</th>
            <th className="px-5 py-2 text-[10px] font-semibold text-[#6B6B6B] uppercase tracking-wider">
              Why it&apos;s here
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#E5E5E5]">
          {items.map((item) => (
            <tr key={item.priority} className="hover:bg-[#fafafa]">
              <td className="px-5 py-3 align-top">
                <span className="inline-flex items-center justify-center w-[22px] h-[22px] rounded-full bg-[#1A1A1A] text-white text-[11px] font-bold">
                  {item.priority}
                </span>
              </td>
              <td className="px-5 py-3 align-top text-[13px] font-medium text-[#1A1A1A] break-words">{item.fix}</td>
              <td className="px-5 py-3 align-top text-[13px] text-[#6B6B6B] break-words">{item.scope}</td>
              <td className="px-5 py-3 align-top">
                <span
                  className="text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
                  style={{ backgroundColor: `${EFFORT_COLOR[item.effort]}1A`, color: EFFORT_COLOR[item.effort] }}
                >
                  {item.effort}
                </span>
              </td>
              <td className="px-5 py-3 align-top text-[13px] text-[#6B6B6B] leading-relaxed break-words">{item.why}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
