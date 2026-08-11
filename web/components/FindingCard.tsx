import type { Finding, FindingSeverity } from "@/lib/findings";

const SEVERITY_STYLES: Record<FindingSeverity, { border: string; bg: string; text: string; label: string }> = {
  critical: { border: "#B91C1C", bg: "#B91C1C1A", text: "#B91C1C", label: "Critical" },
  high: { border: "#D97706", bg: "#D977061A", text: "#D97706", label: "High" },
  medium: { border: "#3B82F6", bg: "#3B82F61A", text: "#3B82F6", label: "Medium" },
  low: { border: "#9A9A9A", bg: "#fafafa", text: "#6B6B6B", label: "Low" },
  good: { border: "#10B981", bg: "#10B9811A", text: "#10B981", label: "Positive" },
};

export function FindingCard({ finding }: { finding: Finding }) {
  const style = SEVERITY_STYLES[finding.severity];
  return (
    <div
      className="bg-white border border-[#E5E5E5] rounded-lg px-5 py-4 border-l-4"
      style={{ borderLeftColor: style.border }}
    >
      <div className="flex items-start justify-between gap-3 mb-1.5">
        <h3 className="text-[14.5px] font-semibold text-[#1A1A1A]">{finding.title}</h3>
        <span
          className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0 mt-0.5"
          style={{ backgroundColor: style.bg, color: style.text }}
        >
          {style.label}
        </span>
      </div>
      <p className="text-[13.5px] text-[#6B6B6B] leading-relaxed m-0">{finding.description}</p>
      {finding.displayValue && <p className="text-xs text-[#9A9A9A] mt-1.5 mb-0">{finding.displayValue}</p>}
      {finding.codeFix && (
        <pre className="mt-3 bg-[#1A1A1A] text-[#E5E5E5] rounded-md p-3 text-[12px] leading-relaxed overflow-x-auto">
          <code>{finding.codeFix}</code>
        </pre>
      )}
    </div>
  );
}
