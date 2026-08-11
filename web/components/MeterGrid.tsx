import { colorForScore } from "@/lib/shared";

export function MeterGrid({ meters }: { meters: { label: string; score: number }[] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-5 bg-white border border-[#E5E5E5] rounded-lg px-5 py-4">
      {meters.map((m) => {
        const color = colorForScore(m.score);
        return (
          <div key={m.label}>
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9A9A9A]">{m.label}</span>
              <span className="text-[15px] font-semibold tabular-nums" style={{ color }}>
                {m.score}
              </span>
            </div>
            <div className="h-2 bg-[#E5E5E5] rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${m.score}%`, backgroundColor: color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
